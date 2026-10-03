-- TINDIO Phase 12: immutable kitchen-order snapshots from completed dining sales.
-- Kitchen activity is operational only. It never changes the sale, payment,
-- inventory, or open-ticket records that produced the order.

begin;

insert into public.permissions (code, category, name, description)
values
  ('kitchen.view', 'Kitchen', 'View kitchen display', 'View active kitchen orders for assigned stores.'),
  ('kitchen.manage', 'Kitchen', 'Manage kitchen orders', 'Advance kitchen orders through preparation and completion.')
on conflict (code) do update
set
  category = excluded.category,
  name = excluded.name,
  description = excluded.description;

insert into public.role_permissions (organization_id, role_id, permission_code)
select role.organization_id, role.id, permission.code
from public.roles role
join public.permissions permission
  on permission.code in ('kitchen.view', 'kitchen.manage')
where role.code in ('owner', 'admin', 'manager')
on conflict do nothing;

-- Keep newly bootstrapped manager roles aligned with the existing manager role.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.bootstrap_organization(text,text,text,text,text)'::regprocedure
  )
  into function_definition;

  if position(
    '''reports.view'', ''registers.manage'', ''dashboard.view'''
    in function_definition
  ) = 0 then
    raise exception 'Unexpected bootstrap_organization definition; aborting safe Phase 12 permission update.';
  end if;

  function_definition := replace(
    function_definition,
    '''reports.view'', ''registers.manage'', ''dashboard.view''',
    '''reports.view'', ''registers.manage'', ''dashboard.view'', ''kitchen.view'', ''kitchen.manage'''
  );
  execute function_definition;
end;
$$;

alter table public.sale_items
  add constraint sale_items_id_organization_unique unique (id, organization_id);

create table public.kitchen_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  store_id uuid not null,
  register_id uuid not null,
  sale_id uuid not null,
  order_number bigint not null,
  dining_option_name_snapshot text not null,
  order_label text not null,
  order_note text,
  status text not null default 'NEW',
  started_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kitchen_orders_id_organization_unique unique (id, organization_id),
  constraint kitchen_orders_store_organization_fkey
    foreign key (store_id, organization_id) references public.stores (id, organization_id) on delete restrict,
  constraint kitchen_orders_register_organization_fkey
    foreign key (register_id, organization_id) references public.registers (id, organization_id) on delete restrict,
  constraint kitchen_orders_sale_organization_fkey
    foreign key (sale_id, organization_id) references public.sales (id, organization_id) on delete restrict,
  constraint kitchen_orders_sale_unique unique (organization_id, sale_id),
  constraint kitchen_orders_number_unique unique (organization_id, order_number),
  constraint kitchen_orders_dining_name_length check (char_length(btrim(dining_option_name_snapshot)) between 1 and 60),
  constraint kitchen_orders_label_length check (char_length(btrim(order_label)) between 1 and 100),
  constraint kitchen_orders_note_length check (order_note is null or char_length(order_note) <= 500),
  constraint kitchen_orders_status_values check (status in ('NEW', 'PREPARING', 'READY', 'COMPLETED')),
  constraint kitchen_orders_status_timestamps check (
    (status = 'NEW' and started_at is null and ready_at is null and completed_at is null)
    or (status = 'PREPARING' and started_at is not null and ready_at is null and completed_at is null)
    or (status = 'READY' and started_at is not null and ready_at is not null and completed_at is null)
    or (status = 'COMPLETED' and started_at is not null and ready_at is not null and completed_at is not null)
  )
);

create table public.kitchen_order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  kitchen_order_id uuid not null,
  sale_item_id uuid not null,
  line_number smallint not null,
  product_name_snapshot text not null,
  variant_name_snapshot text,
  modifiers_snapshot jsonb not null default '[]'::jsonb,
  quantity integer not null,
  created_at timestamptz not null default now(),
  constraint kitchen_order_items_order_organization_fkey
    foreign key (kitchen_order_id, organization_id) references public.kitchen_orders (id, organization_id) on delete restrict,
  constraint kitchen_order_items_sale_item_organization_fkey
    foreign key (sale_item_id, organization_id) references public.sale_items (id, organization_id) on delete restrict,
  constraint kitchen_order_items_line_unique unique (kitchen_order_id, line_number),
  constraint kitchen_order_items_name_length check (char_length(btrim(product_name_snapshot)) between 1 and 160),
  constraint kitchen_order_items_variant_length check (variant_name_snapshot is null or char_length(variant_name_snapshot) between 1 and 160),
  constraint kitchen_order_items_modifiers_array check (jsonb_typeof(modifiers_snapshot) = 'array'),
  constraint kitchen_order_items_quantity_positive check (quantity between 1 and 10000)
);

create index kitchen_orders_active_queue_idx
  on public.kitchen_orders (organization_id, store_id, status, created_at)
  where status in ('NEW', 'PREPARING', 'READY');

create index kitchen_order_items_order_idx
  on public.kitchen_order_items (organization_id, kitchen_order_id, line_number);

alter table public.kitchen_orders enable row level security;
alter table public.kitchen_order_items enable row level security;

revoke all on table public.kitchen_orders, public.kitchen_order_items
from public, anon, authenticated, service_role;

create trigger kitchen_orders_set_updated_at
before update on public.kitchen_orders
for each row execute function private.set_updated_at();

create or replace function private.kitchen_realtime_topic(
  target_organization_id uuid,
  target_store_id uuid
)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'tindio:kitchen:' || $1::text || ':' || $2::text;
$$;

create or replace function private.can_access_kitchen_realtime_topic(
  target_topic text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.employees employee
      join public.employee_stores employee_store
        on employee_store.employee_id = employee.id
       and employee_store.organization_id = employee.organization_id
      join public.employee_roles employee_role
        on employee_role.employee_id = employee.id
       and employee_role.organization_id = employee.organization_id
      join public.role_permissions role_permission
        on role_permission.role_id = employee_role.role_id
       and role_permission.organization_id = employee_role.organization_id
      where employee.profile_id = (select auth.uid())
        and employee.status = 'active'
        and role_permission.permission_code in ('kitchen.view', 'kitchen.manage')
        and target_topic = private.kitchen_realtime_topic(
          employee.organization_id,
          employee_store.store_id
        )
    ),
    false
  );
$$;

create or replace function private.broadcast_kitchen_order_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'order_id', new.id,
      'store_id', new.store_id,
      'status', new.status,
      'updated_at', new.updated_at
    ),
    'kitchen-order-changed',
    private.kitchen_realtime_topic(new.organization_id, new.store_id),
    true
  );
  return null;
end;
$$;

create or replace function private.issue_kitchen_order_from_completed_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_order_id uuid;
  resolved_order_number bigint;
begin
  if new.dining_option_id is null or old.dining_option_id is not null then
    return new;
  end if;

  select receipt.receipt_number
  into resolved_order_number
  from public.receipts receipt
  where receipt.organization_id = new.organization_id
    and receipt.sale_id = new.id;

  if resolved_order_number is null then
    raise exception 'A completed dining sale must have a receipt before it can be sent to the kitchen.' using errcode = '23514';
  end if;

  insert into public.kitchen_orders (
    organization_id,
    store_id,
    register_id,
    sale_id,
    order_number,
    dining_option_name_snapshot,
    order_label,
    order_note
  )
  values (
    new.organization_id,
    new.store_id,
    new.register_id,
    new.id,
    resolved_order_number,
    new.dining_option_name_snapshot,
    coalesce(
      (
        select ticket.label
        from public.open_tickets ticket
        where ticket.organization_id = new.organization_id
          and ticket.id = new.open_ticket_id
      ),
      'Order #' || resolved_order_number::text
    ),
    (
      select ticket.note
      from public.open_tickets ticket
      where ticket.organization_id = new.organization_id
        and ticket.id = new.open_ticket_id
    )
  )
  returning id into resolved_order_id;

  insert into public.kitchen_order_items (
    organization_id,
    kitchen_order_id,
    sale_item_id,
    line_number,
    product_name_snapshot,
    variant_name_snapshot,
    modifiers_snapshot,
    quantity
  )
  select
    sale_item.organization_id,
    resolved_order_id,
    sale_item.id,
    row_number() over (order by sale_item.created_at, sale_item.id)::smallint,
    sale_item.product_name_snapshot,
    sale_item.variant_name_snapshot,
    sale_item.modifiers_snapshot,
    sale_item.quantity
  from public.sale_items sale_item
  where sale_item.organization_id = new.organization_id
    and sale_item.sale_id = new.id;

  if not found then
    raise exception 'A completed dining sale must have at least one line before it can be sent to the kitchen.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger sales_issue_kitchen_order
after update of dining_option_id on public.sales
for each row execute function private.issue_kitchen_order_from_completed_sale();

create trigger kitchen_orders_broadcast_change
after insert or update of status on public.kitchen_orders
for each row execute function private.broadcast_kitchen_order_change();

create or replace function private.get_kitchen_orders(
  target_organization_id uuid,
  target_store_id uuid default null
)
returns table (
  kitchen_order_id uuid,
  store_id uuid,
  store_name text,
  order_number bigint,
  order_label text,
  order_note text,
  dining_option_name text,
  status text,
  created_at timestamptz,
  started_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  items jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not (
      (select private.has_permission(target_organization_id, 'kitchen.view'))
      or (select private.has_permission(target_organization_id, 'kitchen.manage'))
    ) then
    raise exception 'Kitchen display access is required.' using errcode = '42501';
  end if;

  return query
  select
    kitchen_order.id,
    kitchen_order.store_id,
    store.name,
    kitchen_order.order_number,
    kitchen_order.order_label,
    kitchen_order.order_note,
    kitchen_order.dining_option_name_snapshot,
    kitchen_order.status,
    kitchen_order.created_at,
    kitchen_order.started_at,
    kitchen_order.ready_at,
    kitchen_order.completed_at,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', kitchen_item.product_name_snapshot,
          'variant_name', kitchen_item.variant_name_snapshot,
          'modifiers', kitchen_item.modifiers_snapshot,
          'quantity', kitchen_item.quantity
        ) order by kitchen_item.line_number
      ) filter (where kitchen_item.id is not null),
      '[]'::jsonb
    )
  from public.kitchen_orders kitchen_order
  join public.stores store
    on store.id = kitchen_order.store_id
   and store.organization_id = kitchen_order.organization_id
  left join public.kitchen_order_items kitchen_item
    on kitchen_item.kitchen_order_id = kitchen_order.id
   and kitchen_item.organization_id = kitchen_order.organization_id
  where kitchen_order.organization_id = target_organization_id
    and (target_store_id is null or kitchen_order.store_id = target_store_id)
    and (
      kitchen_order.status <> 'COMPLETED'
      or kitchen_order.completed_at >= now() - interval '4 hours'
    )
    and exists (
      select 1
      from public.employees employee
      join public.employee_stores employee_store
        on employee_store.employee_id = employee.id
       and employee_store.organization_id = employee.organization_id
      where employee.organization_id = target_organization_id
        and employee.profile_id = (select auth.uid())
        and employee.status = 'active'
        and employee_store.store_id = kitchen_order.store_id
    )
  group by
    kitchen_order.id,
    kitchen_order.store_id,
    store.name,
    kitchen_order.order_number,
    kitchen_order.order_label,
    kitchen_order.order_note,
    kitchen_order.dining_option_name_snapshot,
    kitchen_order.status,
    kitchen_order.created_at,
    kitchen_order.started_at,
    kitchen_order.ready_at,
    kitchen_order.completed_at
  order by
    case kitchen_order.status
      when 'NEW' then 1
      when 'PREPARING' then 2
      when 'READY' then 3
      else 4
    end,
    kitchen_order.created_at;
end;
$$;

create or replace function public.get_kitchen_orders(
  target_organization_id uuid,
  target_store_id uuid default null
)
returns table (
  kitchen_order_id uuid,
  store_id uuid,
  store_name text,
  order_number bigint,
  order_label text,
  order_note text,
  dining_option_name text,
  status text,
  created_at timestamptz,
  started_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  items jsonb
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.get_kitchen_orders($1, $2);
$$;

create or replace function private.update_kitchen_order_status(
  target_organization_id uuid,
  target_kitchen_order_id uuid,
  target_status text
)
returns table (status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
  resolved_store_id uuid;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'kitchen.manage')) then
    raise exception 'Kitchen order management access is required.' using errcode = '42501';
  end if;

  if target_status not in ('PREPARING', 'READY', 'COMPLETED') then
    raise exception 'Choose a valid next kitchen status.' using errcode = '22023';
  end if;

  select kitchen_order.status, kitchen_order.store_id
  into current_status, resolved_store_id
  from public.kitchen_orders kitchen_order
  where kitchen_order.id = target_kitchen_order_id
    and kitchen_order.organization_id = target_organization_id
  for update;

  if current_status is null then
    raise exception 'This kitchen order is no longer available.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.employees employee
    join public.employee_stores employee_store
      on employee_store.employee_id = employee.id
     and employee_store.organization_id = employee.organization_id
    where employee.organization_id = target_organization_id
      and employee.profile_id = (select auth.uid())
      and employee.status = 'active'
      and employee_store.store_id = resolved_store_id
  ) then
    raise exception 'You are not assigned to this kitchen order store.' using errcode = '42501';
  end if;

  if not (
    (current_status = 'NEW' and target_status = 'PREPARING')
    or (current_status = 'PREPARING' and target_status = 'READY')
    or (current_status = 'READY' and target_status = 'COMPLETED')
  ) then
    raise exception 'Kitchen orders must be advanced one status at a time.' using errcode = '23514';
  end if;

  return query
  update public.kitchen_orders kitchen_order
  set
    status = target_status,
    started_at = case when target_status = 'PREPARING' then now() else kitchen_order.started_at end,
    ready_at = case when target_status = 'READY' then now() else kitchen_order.ready_at end,
    completed_at = case when target_status = 'COMPLETED' then now() else kitchen_order.completed_at end
  where kitchen_order.id = target_kitchen_order_id
    and kitchen_order.organization_id = target_organization_id
  returning kitchen_order.status;
end;
$$;

create or replace function public.update_kitchen_order_status(
  target_organization_id uuid,
  target_kitchen_order_id uuid,
  target_status text
)
returns table (status text)
language sql
security invoker
set search_path = ''
as $$
  select * from private.update_kitchen_order_status($1, $2, $3);
$$;

revoke execute on function
  private.kitchen_realtime_topic(uuid, uuid),
  private.can_access_kitchen_realtime_topic(text),
  private.broadcast_kitchen_order_change(),
  private.issue_kitchen_order_from_completed_sale(),
  private.get_kitchen_orders(uuid, uuid),
  private.update_kitchen_order_status(uuid, uuid, text)
from public, anon, authenticated, service_role;

revoke execute on function
  public.get_kitchen_orders(uuid, uuid),
  public.update_kitchen_order_status(uuid, uuid, text)
from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;
grant execute on function
  private.can_access_kitchen_realtime_topic(text),
  private.get_kitchen_orders(uuid, uuid),
  private.update_kitchen_order_status(uuid, uuid, text)
to authenticated;

grant execute on function
  public.get_kitchen_orders(uuid, uuid),
  public.update_kitchen_order_status(uuid, uuid, text)
to authenticated;

drop policy if exists kitchen_display_receive_broadcasts on realtime.messages;
create policy kitchen_display_receive_broadcasts
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (select private.can_access_kitchen_realtime_topic(realtime.topic()))
);

comment on table public.kitchen_orders
is 'Phase 12 kitchen workflow snapshots issued atomically from completed sales with a dining option. Direct table access is disabled.';

comment on function public.get_kitchen_orders(uuid, uuid)
is 'Returns active and recently completed kitchen orders only to assigned employees with kitchen display access.';

comment on function public.update_kitchen_order_status(uuid, uuid, text)
is 'Advances an assigned store kitchen order through NEW, PREPARING, READY, and COMPLETED without changing financial records.';

commit;
