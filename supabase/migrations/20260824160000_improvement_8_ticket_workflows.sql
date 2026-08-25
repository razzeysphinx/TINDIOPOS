-- Improvement 8: complete the established advanced-sale implementation with
-- ticket templates, employee assignments, line notes, and auditable ticket
-- reallocation. Existing checkout, payment, stock, and receipt routines stay
-- authoritative.

begin;

alter table public.open_tickets
  add column assigned_employee_id uuid,
  add column merged_into_ticket_id uuid;

update public.open_tickets
set assigned_employee_id = opened_by_employee_id
where assigned_employee_id is null;

alter table public.open_tickets
  alter column assigned_employee_id set not null,
  add constraint open_tickets_assigned_employee_organization_fkey
    foreign key (assigned_employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete restrict,
  add constraint open_tickets_merged_into_organization_fkey
    foreign key (merged_into_ticket_id, organization_id)
    references public.open_tickets (id, organization_id)
    on delete restrict,
  drop constraint open_tickets_status_values,
  drop constraint open_tickets_completion_state,
  add constraint open_tickets_status_values check (status in ('open', 'completed', 'cancelled', 'merged')),
  add constraint open_tickets_completion_state check (
    (status = 'open' and sale_id is null and merged_into_ticket_id is null)
    or (status = 'cancelled' and sale_id is null and merged_into_ticket_id is null)
    or (status = 'completed' and sale_id is not null and merged_into_ticket_id is null)
    or (status = 'merged' and sale_id is null and merged_into_ticket_id is not null)
  );

create index open_tickets_assigned_employee_open_idx
  on public.open_tickets (organization_id, assigned_employee_id, updated_at desc)
  where status = 'open';

alter table public.sale_items
  add column item_note text,
  add constraint sale_items_item_note_length check (
    item_note is null or char_length(btrim(item_note)) between 1 and 500
  );

create table public.ticket_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  created_by_employee_id uuid not null,
  label text not null,
  note text,
  dining_option_id uuid,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_templates_id_organization_unique unique (id, organization_id),
  constraint ticket_templates_creator_organization_fkey
    foreign key (created_by_employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete restrict,
  constraint ticket_templates_dining_option_organization_fkey
    foreign key (dining_option_id, organization_id)
    references public.dining_options (id, organization_id)
    on delete restrict,
  constraint ticket_templates_label_length check (char_length(btrim(label)) between 1 and 100),
  constraint ticket_templates_note_length check (
    note is null or char_length(btrim(note)) between 1 and 500
  ),
  constraint ticket_templates_sort_order_nonnegative check (sort_order >= 0)
);

create unique index ticket_templates_organization_label_unique_idx
  on public.ticket_templates (organization_id, lower(btrim(label)));
create index ticket_templates_organization_active_sort_idx
  on public.ticket_templates (organization_id, is_active, sort_order, lower(label));

create trigger ticket_templates_set_updated_at
before update on public.ticket_templates
for each row execute function private.set_updated_at();

alter table public.ticket_templates enable row level security;

revoke all on table public.ticket_templates from public, anon, authenticated, service_role;
grant select, insert, update on table public.ticket_templates to authenticated;

create policy ticket_templates_select_sales_or_manager
on public.ticket_templates
for select
to authenticated
using (
  (select private.has_permission(organization_id, 'sales.create'))
  or (select private.has_permission(organization_id, 'products.manage'))
);

create policy ticket_templates_insert_manager
on public.ticket_templates
for insert
to authenticated
with check ((select private.has_permission(organization_id, 'products.manage')));

create policy ticket_templates_update_manager
on public.ticket_templates
for update
to authenticated
using ((select private.has_permission(organization_id, 'products.manage')))
with check ((select private.has_permission(organization_id, 'products.manage')));

create or replace function private.normalize_open_ticket_cart(target_cart jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_cart jsonb;
begin
  if target_cart is null or jsonb_typeof(target_cart) <> 'array'
    or jsonb_array_length(target_cart) not between 1 and 100 then
    raise exception 'An open ticket must contain between 1 and 100 items.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_cart) line(value)
    where jsonb_typeof(line.value) <> 'object'
      or (
        line.value ? 'ticket_line_id'
        and (
          jsonb_typeof(line.value -> 'ticket_line_id') <> 'string'
          or coalesce(line.value ->> 'ticket_line_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
      )
      or (
        line.value ? 'item_note'
        and line.value -> 'item_note' <> 'null'::jsonb
        and (
          jsonb_typeof(line.value -> 'item_note') <> 'string'
          or char_length(btrim(line.value ->> 'item_note')) not between 1 and 500
        )
      )
  ) then
    raise exception 'Ticket item notes or line references are invalid.' using errcode = '23514';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(target_cart) line(value)
    where line.value ? 'ticket_line_id'
  ) <> (
    select count(distinct line.value ->> 'ticket_line_id')
    from jsonb_array_elements(target_cart) line(value)
    where line.value ? 'ticket_line_id'
  ) then
    raise exception 'Each ticket line must have a unique reference.' using errcode = '23514';
  end if;

  select coalesce(
    jsonb_agg(
      line.value || jsonb_build_object(
        'ticket_line_id', coalesce(line.value ->> 'ticket_line_id', gen_random_uuid()::text),
        'item_note', nullif(btrim(coalesce(line.value ->> 'item_note', '')), '')
      )
      order by line.ordinality
    ),
    '[]'::jsonb
  )
  into normalized_cart
  from jsonb_array_elements(target_cart) with ordinality line(value, ordinality);

  return normalized_cart;
end;
$$;

revoke execute on function private.normalize_open_ticket_cart(jsonb)
from public, anon, authenticated, service_role;

update public.open_tickets ticket
set cart = private.normalize_open_ticket_cart(ticket.cart)
where ticket.status in ('open', 'completed', 'cancelled');

create function public.get_pos_ticket_assignees(
  target_organization_id uuid,
  target_store_id uuid
)
returns table (
  employee_id uuid,
  full_name text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_pos_workspace_access(target_organization_id, target_store_id);

  if not (select private.has_permission(target_organization_id, 'employees.manage')) then
    raise exception 'Employee management permission is required to assign tickets.' using errcode = '42501';
  end if;

  return query
  select
    employee.id,
    coalesce(nullif(btrim(profile.full_name), ''), profile.email)
  from public.employees employee
  join public.employee_stores employee_store
    on employee_store.employee_id = employee.id
   and employee_store.organization_id = employee.organization_id
  join public.profiles profile on profile.id = employee.profile_id
  where employee.organization_id = target_organization_id
    and employee_store.store_id = target_store_id
    and employee.status = 'active'
  order by lower(coalesce(nullif(btrim(profile.full_name), ''), profile.email)), employee.id;
end;
$$;

create function public.get_pos_open_tickets(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid
)
returns table (
  ticket_id uuid,
  label text,
  note text,
  cart jsonb,
  customer_id uuid,
  customer_number bigint,
  loyalty_card_code text,
  customer_full_name text,
  customer_phone text,
  customer_email text,
  customer_loyalty_points integer,
  dining_option_id uuid,
  assigned_employee_id uuid,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_active_pos_shift(
    target_organization_id,
    target_store_id,
    target_register_id
  );

  return query
  select
    ticket.id,
    ticket.label,
    ticket.note,
    ticket.cart,
    customer.id,
    customer.customer_number,
    customer.loyalty_card_code,
    customer.full_name,
    customer.phone,
    customer.email,
    coalesce((
      select sum(transaction.points_delta)::integer
      from public.loyalty_transactions transaction
      where transaction.organization_id = ticket.organization_id
        and transaction.customer_id = customer.id
    ), 0)::integer,
    ticket.dining_option_id,
    ticket.assigned_employee_id,
    ticket.updated_at
  from public.open_tickets ticket
  left join public.customers customer
    on customer.id = ticket.customer_id
   and customer.organization_id = ticket.organization_id
  where ticket.organization_id = target_organization_id
    and ticket.store_id = target_store_id
    and ticket.register_id = target_register_id
    and ticket.status = 'open'
  order by ticket.updated_at desc, ticket.id;
end;
$$;

create function private.save_open_ticket_v2(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_ticket_id uuid,
  target_customer_id uuid,
  target_dining_option_id uuid,
  target_assigned_employee_id uuid,
  target_label text,
  target_note text,
  target_cart jsonb
)
returns table (ticket_id uuid, created_at timestamptz, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  selected_assignee_id uuid;
  normalized_label text := nullif(btrim(coalesce(target_label, '')), '');
  normalized_note text := nullif(btrim(coalesce(target_note, '')), '');
  normalized_cart jsonb;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;

  if normalized_label is null or char_length(normalized_label) > 100
    or (normalized_note is not null and char_length(normalized_note) > 500) then
    raise exception 'Enter a ticket label up to 100 characters and an optional note up to 500 characters.' using errcode = '23514';
  end if;

  actor_employee_id := private.require_active_pos_shift(
    target_organization_id,
    target_store_id,
    target_register_id
  );
  selected_assignee_id := coalesce(target_assigned_employee_id, actor_employee_id);

  if selected_assignee_id <> actor_employee_id
    and not (select private.has_permission(target_organization_id, 'employees.manage')) then
    raise exception 'Employee management permission is required to reassign tickets.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.employees employee
    join public.employee_stores employee_store
      on employee_store.employee_id = employee.id
     and employee_store.organization_id = employee.organization_id
    where employee.id = selected_assignee_id
      and employee.organization_id = target_organization_id
      and employee_store.store_id = target_store_id
      and employee.status = 'active'
  ) then
    raise exception 'Assign this ticket to an active employee at the selected store.' using errcode = '23514';
  end if;

  perform private.validate_advanced_cart(target_organization_id, target_store_id, target_cart);
  normalized_cart := private.normalize_open_ticket_cart(target_cart);

  if target_customer_id is not null and not exists (
    select 1 from public.customers customer
    where customer.id = target_customer_id
      and customer.organization_id = target_organization_id
      and customer.status = 'active'
  ) then
    raise exception 'The selected customer is not active in this organization.' using errcode = '23514';
  end if;

  if target_dining_option_id is not null and not exists (
    select 1 from public.dining_options option
    where option.id = target_dining_option_id
      and option.organization_id = target_organization_id
      and option.is_active
  ) then
    raise exception 'The selected dining option is not active.' using errcode = '23514';
  end if;

  if target_ticket_id is null then
    return query
    insert into public.open_tickets as open_ticket (
      organization_id, store_id, register_id, opened_by_employee_id,
      assigned_employee_id, customer_id, dining_option_id, label, note, cart
    )
    values (
      target_organization_id, target_store_id, target_register_id, actor_employee_id,
      selected_assignee_id, target_customer_id, target_dining_option_id,
      normalized_label, normalized_note, normalized_cart
    )
    returning open_ticket.id, open_ticket.created_at, open_ticket.updated_at;
    return;
  end if;

  return query
  update public.open_tickets ticket
  set
    customer_id = target_customer_id,
    dining_option_id = target_dining_option_id,
    assigned_employee_id = selected_assignee_id,
    label = normalized_label,
    note = normalized_note,
    cart = normalized_cart
  where ticket.id = target_ticket_id
    and ticket.organization_id = target_organization_id
    and ticket.store_id = target_store_id
    and ticket.register_id = target_register_id
    and ticket.status = 'open'
  returning ticket.id, ticket.created_at, ticket.updated_at;

  if not found then
    raise exception 'This open ticket is no longer available.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function private.save_open_ticket(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_ticket_id uuid,
  target_customer_id uuid,
  target_dining_option_id uuid,
  target_label text,
  target_note text,
  target_cart jsonb
)
returns table (ticket_id uuid, created_at timestamptz, updated_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select *
  from private.save_open_ticket_v2(
    target_organization_id,
    target_store_id,
    target_register_id,
    target_ticket_id,
    target_customer_id,
    target_dining_option_id,
    null,
    target_label,
    target_note,
    target_cart
  );
$$;

create function public.save_open_ticket_v2(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_ticket_id uuid,
  target_customer_id uuid,
  target_dining_option_id uuid,
  target_assigned_employee_id uuid,
  target_label text,
  target_note text,
  target_cart jsonb
)
returns table (ticket_id uuid, created_at timestamptz, updated_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select *
  from private.save_open_ticket_v2(
    target_organization_id,
    target_store_id,
    target_register_id,
    target_ticket_id,
    target_customer_id,
    target_dining_option_id,
    target_assigned_employee_id,
    target_label,
    target_note,
    target_cart
  );
$$;

create function private.reallocate_open_ticket_lines(
  target_organization_id uuid,
  target_source_ticket_id uuid,
  target_destination_ticket_id uuid,
  target_lines jsonb,
  target_preserve_empty_source boolean,
  target_replace_destination boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_ticket public.open_tickets%rowtype;
  destination_ticket public.open_tickets%rowtype;
  source_line jsonb;
  selected_quantity numeric(14, 3);
  source_quantity numeric(14, 3);
  remaining_quantity numeric(14, 3);
  source_next_cart jsonb := '[]'::jsonb;
  destination_next_cart jsonb;
  moved_line_count integer := 0;
begin
  if target_source_ticket_id is null
    or target_destination_ticket_id is null
    or target_source_ticket_id = target_destination_ticket_id
    or target_lines is null
    or jsonb_typeof(target_lines) <> 'array'
    or jsonb_array_length(target_lines) not between 1 and 100 then
    raise exception 'Choose distinct tickets and between 1 and 100 ticket lines.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_lines) requested(value)
    where jsonb_typeof(requested.value) <> 'object'
      or jsonb_typeof(requested.value -> 'ticket_line_id') <> 'string'
      or coalesce(requested.value ->> 'ticket_line_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(requested.value -> 'quantity') <> 'number'
      or coalesce(requested.value ->> 'quantity', '') !~ '^(?:0|[1-9][0-9]{0,3})([.][0-9]{1,3})?$'
      or (requested.value ->> 'quantity')::numeric(14, 3) <= 0
  ) then
    raise exception 'Choose valid ticket items and quantities.' using errcode = '23514';
  end if;

  if (
    select count(*) from jsonb_array_elements(target_lines) requested(value)
  ) <> (
    select count(distinct requested.value ->> 'ticket_line_id')
    from jsonb_array_elements(target_lines) requested(value)
  ) then
    raise exception 'Choose each ticket line only once.' using errcode = '23514';
  end if;

  perform 1
  from public.open_tickets ticket
  where ticket.organization_id = target_organization_id
    and ticket.id in (target_source_ticket_id, target_destination_ticket_id)
  order by ticket.id
  for update;

  select ticket.* into source_ticket
  from public.open_tickets ticket
  where ticket.id = target_source_ticket_id
    and ticket.organization_id = target_organization_id;
  select ticket.* into destination_ticket
  from public.open_tickets ticket
  where ticket.id = target_destination_ticket_id
    and ticket.organization_id = target_organization_id;

  if source_ticket.id is null
    or destination_ticket.id is null
    or source_ticket.status <> 'open'
    or destination_ticket.status <> 'open'
    or source_ticket.store_id <> destination_ticket.store_id
    or source_ticket.register_id <> destination_ticket.register_id then
    raise exception 'Both tickets must be open on the same register.' using errcode = '23514';
  end if;

  perform private.require_active_pos_shift(
    target_organization_id,
    source_ticket.store_id,
    source_ticket.register_id
  );

  if exists (
    select 1
    from jsonb_array_elements(target_lines) requested(value)
    left join jsonb_array_elements(source_ticket.cart) source_line(value)
      on source_line.value ->> 'ticket_line_id' = requested.value ->> 'ticket_line_id'
    where source_line.value is null
  ) then
    raise exception 'One or more selected ticket items are no longer available.' using errcode = 'P0002';
  end if;

  destination_next_cart := case
    when target_replace_destination then '[]'::jsonb
    else destination_ticket.cart
  end;

  for source_line in
    select line.value
    from jsonb_array_elements(source_ticket.cart) line(value)
  loop
    select (requested.value ->> 'quantity')::numeric(14, 3)
    into selected_quantity
    from jsonb_array_elements(target_lines) requested(value)
    where requested.value ->> 'ticket_line_id' = source_line ->> 'ticket_line_id';

    if selected_quantity is null then
      source_next_cart := source_next_cart || jsonb_build_array(source_line);
      continue;
    end if;

    source_quantity := (source_line ->> 'quantity')::numeric(14, 3);
    if selected_quantity > source_quantity then
      raise exception 'A ticket item cannot move more than its saved quantity.' using errcode = '23514';
    end if;

    remaining_quantity := source_quantity - selected_quantity;
    if remaining_quantity > 0 then
      source_next_cart := source_next_cart || jsonb_build_array(
        source_line || jsonb_build_object('quantity', remaining_quantity)
      );
    end if;

    destination_next_cart := destination_next_cart || jsonb_build_array(
      source_line
      || jsonb_build_object('quantity', selected_quantity)
      || case
        when remaining_quantity > 0 then jsonb_build_object('ticket_line_id', gen_random_uuid()::text)
        else '{}'::jsonb
      end
    );
    moved_line_count := moved_line_count + 1;
  end loop;

  if jsonb_array_length(destination_next_cart) > 100 then
    raise exception 'A ticket can contain at most 100 items.' using errcode = '23514';
  end if;

  if jsonb_array_length(source_next_cart) = 0 and not target_preserve_empty_source then
    raise exception 'Keep at least one item on the source ticket, or merge it instead.' using errcode = '23514';
  end if;

  if jsonb_array_length(source_next_cart) > 0 then
    update public.open_tickets ticket
    set cart = source_next_cart
    where ticket.id = source_ticket.id
      and ticket.organization_id = target_organization_id;
  end if;

  update public.open_tickets ticket
  set cart = destination_next_cart
  where ticket.id = destination_ticket.id
    and ticket.organization_id = target_organization_id;

  return moved_line_count;
end;
$$;

create function public.move_open_ticket_lines(
  target_organization_id uuid,
  target_source_ticket_id uuid,
  target_destination_ticket_id uuid,
  target_lines jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_ticket public.open_tickets%rowtype;
  actor_employee_id uuid;
  moved_line_count integer;
begin
  select ticket.* into source_ticket
  from public.open_tickets ticket
  where ticket.id = target_source_ticket_id
    and ticket.organization_id = target_organization_id;

  if source_ticket.id is null then
    raise exception 'The source ticket was not found.' using errcode = 'P0002';
  end if;

  actor_employee_id := private.require_active_pos_shift(
    target_organization_id,
    source_ticket.store_id,
    source_ticket.register_id
  );
  moved_line_count := private.reallocate_open_ticket_lines(
    target_organization_id,
    target_source_ticket_id,
    target_destination_ticket_id,
    target_lines,
    false,
    false
  );

  perform private.write_audit_log(
    target_organization_id,
    'OPEN_TICKET_LINES_MOVED',
    'ticket.move',
    actor_employee_id,
    null,
    source_ticket.store_id,
    source_ticket.register_id,
    null,
    null,
    null,
    jsonb_build_object(
      'source_ticket_id', target_source_ticket_id,
      'destination_ticket_id', target_destination_ticket_id,
      'moved_line_count', moved_line_count
    )
  );
end;
$$;

create function public.split_open_ticket(
  target_organization_id uuid,
  target_source_ticket_id uuid,
  target_label text,
  target_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_ticket public.open_tickets%rowtype;
  actor_employee_id uuid;
  normalized_label text := nullif(btrim(coalesce(target_label, '')), '');
  destination_ticket_id uuid;
  moved_line_count integer;
begin
  if normalized_label is null or char_length(normalized_label) > 100 then
    raise exception 'Enter a split-ticket name up to 100 characters.' using errcode = '23514';
  end if;

  select ticket.* into source_ticket
  from public.open_tickets ticket
  where ticket.id = target_source_ticket_id
    and ticket.organization_id = target_organization_id
    and ticket.status = 'open'
  for update;

  if source_ticket.id is null then
    raise exception 'The source ticket is no longer open.' using errcode = 'P0002';
  end if;

  actor_employee_id := private.require_active_pos_shift(
    target_organization_id,
    source_ticket.store_id,
    source_ticket.register_id
  );

  insert into public.open_tickets (
    organization_id, store_id, register_id, opened_by_employee_id,
    assigned_employee_id, customer_id, dining_option_id, label, note, cart
  )
  values (
    target_organization_id, source_ticket.store_id, source_ticket.register_id,
    actor_employee_id, source_ticket.assigned_employee_id, source_ticket.customer_id,
    source_ticket.dining_option_id, normalized_label, source_ticket.note, source_ticket.cart
  )
  returning id into destination_ticket_id;

  moved_line_count := private.reallocate_open_ticket_lines(
    target_organization_id,
    source_ticket.id,
    destination_ticket_id,
    target_lines,
    false,
    true
  );

  perform private.write_audit_log(
    target_organization_id,
    'OPEN_TICKET_SPLIT',
    'ticket.split',
    actor_employee_id,
    null,
    source_ticket.store_id,
    source_ticket.register_id,
    null,
    null,
    normalized_label,
    jsonb_build_object(
      'source_ticket_id', source_ticket.id,
      'split_ticket_id', destination_ticket_id,
      'moved_line_count', moved_line_count
    )
  );

  return destination_ticket_id;
end;
$$;

create function public.merge_open_tickets(
  target_organization_id uuid,
  target_source_ticket_id uuid,
  target_destination_ticket_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_ticket public.open_tickets%rowtype;
  actor_employee_id uuid;
  source_lines jsonb;
  moved_line_count integer;
begin
  if target_source_ticket_id is null
    or target_destination_ticket_id is null
    or target_source_ticket_id = target_destination_ticket_id then
    raise exception 'Choose two distinct open tickets to merge.' using errcode = '23514';
  end if;

  select ticket.* into source_ticket
  from public.open_tickets ticket
  where ticket.id = target_source_ticket_id
    and ticket.organization_id = target_organization_id
    and ticket.status = 'open'
  for update;

  if source_ticket.id is null then
    raise exception 'The source ticket is no longer open.' using errcode = 'P0002';
  end if;

  actor_employee_id := private.require_active_pos_shift(
    target_organization_id,
    source_ticket.store_id,
    source_ticket.register_id
  );

  select jsonb_agg(
    jsonb_build_object(
      'ticket_line_id', line.value ->> 'ticket_line_id',
      'quantity', line.value -> 'quantity'
    )
    order by line.ordinality
  )
  into source_lines
  from jsonb_array_elements(source_ticket.cart) with ordinality line(value, ordinality);

  moved_line_count := private.reallocate_open_ticket_lines(
    target_organization_id,
    target_source_ticket_id,
    target_destination_ticket_id,
    source_lines,
    true,
    false
  );

  update public.open_tickets ticket
  set status = 'merged', merged_into_ticket_id = target_destination_ticket_id
  where ticket.id = target_source_ticket_id
    and ticket.organization_id = target_organization_id;

  perform private.write_audit_log(
    target_organization_id,
    'OPEN_TICKETS_MERGED',
    'ticket.merge',
    actor_employee_id,
    null,
    source_ticket.store_id,
    source_ticket.register_id,
    null,
    null,
    null,
    jsonb_build_object(
      'source_ticket_id', target_source_ticket_id,
      'destination_ticket_id', target_destination_ticket_id,
      'moved_line_count', moved_line_count
    )
  );
end;
$$;

do $$
declare
  function_definition text;
  old_validation text := $old$
    quantity := (line ->> 'quantity')::numeric(14, 3);
    if quantity <= 0 then raise exception 'Each checkout item must have a quantity greater than zero.' using errcode = '23514'; end if;
$old$;
  new_validation text := $new$
    quantity := (line ->> 'quantity')::numeric(14, 3);
    if quantity <= 0 then raise exception 'Each checkout item must have a quantity greater than zero.' using errcode = '23514'; end if;
    if line ? 'item_note' and (
      jsonb_typeof(line -> 'item_note') <> 'string'
      or char_length(btrim(line ->> 'item_note')) not between 1 and 500
    ) then
      raise exception 'Item notes must contain between 1 and 500 characters.' using errcode = '23514';
    end if;
$new$;
  old_quoted_line text := $old$'modifier_total_minor', modifier_price, 'modifiers', option_snapshot));$old$;
  new_quoted_line text := $new$'modifier_total_minor', modifier_price, 'modifiers', option_snapshot, 'item_note', nullif(btrim(line ->> 'item_note'), '')));$new$;
  old_insert_columns text := $old$modifier_total_minor, modifiers_snapshot, line_total_minor)$old$;
  new_insert_columns text := $new$modifier_total_minor, modifiers_snapshot, item_note, line_total_minor)$new$;
  old_insert_values text := $old$line -> 'modifiers', round(((line ->> 'base_price_minor')::bigint + (line ->> 'modifier_total_minor')::bigint)::numeric * (line ->> 'quantity')::numeric(14, 3))::bigint);$old$;
  new_insert_values text := $new$line -> 'modifiers', nullif(btrim(line ->> 'item_note'), ''), round(((line ->> 'base_price_minor')::bigint + (line ->> 'modifier_total_minor')::bigint)::numeric * (line ->> 'quantity')::numeric(14, 3))::bigint);$new$;
begin
  select pg_get_functiondef(
    'private.checkout_advanced_sale(uuid,uuid,uuid,uuid,jsonb,jsonb,uuid,integer,uuid,uuid,uuid,uuid)'::regprocedure
  ) into function_definition;

  if position(old_validation in function_definition) = 0
    or position(old_quoted_line in function_definition) = 0
    or position(old_insert_columns in function_definition) = 0
    or position(old_insert_values in function_definition) = 0 then
    raise exception 'Unexpected advanced checkout definition; aborting item-note extension.';
  end if;

  function_definition := replace(function_definition, old_validation, new_validation);
  function_definition := replace(function_definition, old_quoted_line, new_quoted_line);
  function_definition := replace(function_definition, old_insert_columns, new_insert_columns);
  function_definition := replace(function_definition, old_insert_values, new_insert_values);
  execute function_definition;
end;
$$;

revoke execute on function private.save_open_ticket_v2(uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb), private.reallocate_open_ticket_lines(uuid, uuid, uuid, jsonb, boolean, boolean)
from public, anon, authenticated, service_role;
revoke execute on function public.get_pos_ticket_assignees(uuid, uuid), public.get_pos_open_tickets(uuid, uuid, uuid), public.save_open_ticket_v2(uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb), public.move_open_ticket_lines(uuid, uuid, uuid, jsonb), public.split_open_ticket(uuid, uuid, text, jsonb), public.merge_open_tickets(uuid, uuid, uuid)
from public, anon, service_role;
grant execute on function public.get_pos_ticket_assignees(uuid, uuid), public.get_pos_open_tickets(uuid, uuid, uuid), public.save_open_ticket_v2(uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb), public.move_open_ticket_lines(uuid, uuid, uuid, jsonb), public.split_open_ticket(uuid, uuid, text, jsonb), public.merge_open_tickets(uuid, uuid, uuid)
to authenticated;

comment on table public.ticket_templates
is 'Reusable ticket presets for authorized POS users; templates create tickets but never alter historical ticket snapshots.';
comment on column public.sale_items.item_note
is 'Immutable line-level note captured from a POS cart or open ticket during advanced checkout.';
comment on function public.get_pos_open_tickets(uuid, uuid, uuid)
is 'Returns assigned-register open tickets with safe customer fields only while the caller owns an active POS shift.';
comment on function public.move_open_ticket_lines(uuid, uuid, uuid, jsonb)
is 'Moves selected saved ticket lines atomically between two open tickets on the caller''s active register.';
comment on function public.split_open_ticket(uuid, uuid, text, jsonb)
is 'Creates a new ticket from selected source-ticket lines and records an audit event.';
comment on function public.merge_open_tickets(uuid, uuid, uuid)
is 'Moves all source ticket lines into a destination ticket, preserves the source as merged, and records an audit event.';

commit;
