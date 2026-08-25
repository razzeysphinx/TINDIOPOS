-- TINDIO Phase 8: advanced sales configuration, held tickets, modifiers, and
-- server-quoted advanced checkout. Existing checkout and inventory routines are
-- retained as the atomic stock/receipt boundary; this migration adds a guarded
-- advanced wrapper that replaces the temporary line and payment records before
-- the transaction commits.

begin;

create table public.discounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null,
  discount_type text not null,
  percentage_bps integer,
  amount_minor bigint,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discounts_id_organization_unique unique (id, organization_id),
  constraint discounts_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint discounts_type_values check (discount_type in ('percentage', 'fixed_amount')),
  constraint discounts_value_valid check (
    (discount_type = 'percentage' and percentage_bps between 1 and 10000 and amount_minor is null)
    or (discount_type = 'fixed_amount' and amount_minor > 0 and percentage_bps is null)
  ),
  constraint discounts_sort_order_nonnegative check (sort_order >= 0)
);

create unique index discounts_organization_name_unique_idx
  on public.discounts (organization_id, lower(btrim(name)));
create index discounts_organization_active_sort_idx
  on public.discounts (organization_id, is_active, sort_order, lower(name));

create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null,
  rate_bps integer not null,
  is_inclusive boolean not null default false,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tax_rates_id_organization_unique unique (id, organization_id),
  constraint tax_rates_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint tax_rates_rate_bounds check (rate_bps between 0 and 10000)
);

create unique index tax_rates_one_default_per_organization_idx
  on public.tax_rates (organization_id)
  where is_default and is_active;
create unique index tax_rates_organization_name_unique_idx
  on public.tax_rates (organization_id, lower(btrim(name)));

create table public.dining_options (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null,
  color text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dining_options_id_organization_unique unique (id, organization_id),
  constraint dining_options_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint dining_options_color_format check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint dining_options_sort_order_nonnegative check (sort_order >= 0)
);

create unique index dining_options_one_default_per_organization_idx
  on public.dining_options (organization_id)
  where is_default and is_active;
create unique index dining_options_organization_name_unique_idx
  on public.dining_options (organization_id, lower(btrim(name)));

create table public.modifier_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null,
  min_selections smallint not null default 0,
  max_selections smallint not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint modifier_groups_id_organization_unique unique (id, organization_id),
  constraint modifier_groups_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint modifier_groups_selection_bounds check (
    min_selections between 0 and 50
    and max_selections between 1 and 50
    and min_selections <= max_selections
  )
);

create unique index modifier_groups_organization_name_unique_idx
  on public.modifier_groups (organization_id, lower(btrim(name)));

create table public.modifier_options (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  modifier_group_id uuid not null,
  name text not null,
  price_adjustment_minor bigint not null default 0,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint modifier_options_group_organization_fkey
    foreign key (modifier_group_id, organization_id)
    references public.modifier_groups (id, organization_id)
    on delete restrict,
  constraint modifier_options_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint modifier_options_adjustment_bounds check (price_adjustment_minor between 0 and 1000000000000),
  constraint modifier_options_sort_order_nonnegative check (sort_order >= 0)
);

create unique index modifier_options_group_name_unique_idx
  on public.modifier_options (modifier_group_id, lower(btrim(name)));
create index modifier_options_group_active_sort_idx
  on public.modifier_options (modifier_group_id, is_active, sort_order, lower(name));

create table public.product_modifier_groups (
  organization_id uuid not null,
  product_id uuid not null,
  modifier_group_id uuid not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (product_id, modifier_group_id),
  constraint product_modifier_groups_product_organization_fkey
    foreign key (product_id, organization_id)
    references public.products (id, organization_id)
    on delete restrict,
  constraint product_modifier_groups_group_organization_fkey
    foreign key (modifier_group_id, organization_id)
    references public.modifier_groups (id, organization_id)
    on delete restrict,
  constraint product_modifier_groups_sort_order_nonnegative check (sort_order >= 0)
);

create index product_modifier_groups_organization_product_idx
  on public.product_modifier_groups (organization_id, product_id, sort_order);

create table public.open_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  store_id uuid not null,
  register_id uuid not null,
  opened_by_employee_id uuid not null,
  customer_id uuid,
  dining_option_id uuid,
  label text not null,
  note text,
  cart jsonb not null,
  status text not null default 'open',
  sale_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint open_tickets_id_organization_unique unique (id, organization_id),
  constraint open_tickets_store_organization_fkey
    foreign key (store_id, organization_id) references public.stores (id, organization_id) on delete restrict,
  constraint open_tickets_register_organization_fkey
    foreign key (register_id, organization_id) references public.registers (id, organization_id) on delete restrict,
  constraint open_tickets_employee_organization_fkey
    foreign key (opened_by_employee_id, organization_id) references public.employees (id, organization_id) on delete restrict,
  constraint open_tickets_customer_organization_fkey
    foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete restrict,
  constraint open_tickets_dining_option_organization_fkey
    foreign key (dining_option_id, organization_id) references public.dining_options (id, organization_id) on delete restrict,
  constraint open_tickets_sale_organization_fkey
    foreign key (sale_id, organization_id) references public.sales (id, organization_id) on delete restrict,
  constraint open_tickets_label_length check (char_length(btrim(label)) between 1 and 100),
  constraint open_tickets_note_length check (note is null or char_length(note) <= 500),
  constraint open_tickets_cart_array check (jsonb_typeof(cart) = 'array' and jsonb_array_length(cart) between 1 and 100),
  constraint open_tickets_status_values check (status in ('open', 'completed', 'cancelled')),
  constraint open_tickets_completion_state check (
    (status = 'open' and sale_id is null) or (status = 'cancelled' and sale_id is null) or (status = 'completed' and sale_id is not null)
  )
);

create index open_tickets_organization_store_status_updated_idx
  on public.open_tickets (organization_id, store_id, status, updated_at desc);

create table public.advanced_checkout_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  actor_employee_id uuid not null,
  idempotency_key uuid not null,
  request_payload jsonb not null,
  state text not null default 'processing',
  sale_id uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint advanced_checkout_requests_actor_organization_fkey
    foreign key (actor_employee_id, organization_id) references public.employees (id, organization_id) on delete restrict,
  constraint advanced_checkout_requests_sale_organization_fkey
    foreign key (sale_id, organization_id) references public.sales (id, organization_id) on delete restrict,
  constraint advanced_checkout_requests_organization_key_unique unique (organization_id, idempotency_key),
  constraint advanced_checkout_requests_payload_object check (jsonb_typeof(request_payload) = 'object'),
  constraint advanced_checkout_requests_state_values check (state in ('processing', 'completed')),
  constraint advanced_checkout_requests_completion_state check (
    (state = 'processing' and sale_id is null and completed_at is null)
    or (state = 'completed' and sale_id is not null and completed_at is not null)
  )
);

alter table public.sales
  add column tax_is_inclusive boolean not null default false,
  add column discount_id uuid,
  add column discount_name_snapshot text,
  add column tax_rate_id uuid,
  add column tax_name_snapshot text,
  add column dining_option_id uuid,
  add column dining_option_name_snapshot text,
  add column open_ticket_id uuid;

alter table public.sales drop constraint sales_total_math;
alter table public.sales add constraint sales_total_math check (
  total_minor = subtotal_minor - discount_minor + case when tax_is_inclusive then 0 else tax_minor end
);
alter table public.sales
  add constraint sales_discount_organization_fkey foreign key (discount_id, organization_id)
    references public.discounts (id, organization_id) on delete restrict,
  add constraint sales_tax_rate_organization_fkey foreign key (tax_rate_id, organization_id)
    references public.tax_rates (id, organization_id) on delete restrict,
  add constraint sales_dining_option_organization_fkey foreign key (dining_option_id, organization_id)
    references public.dining_options (id, organization_id) on delete restrict,
  add constraint sales_open_ticket_organization_fkey foreign key (open_ticket_id, organization_id)
    references public.open_tickets (id, organization_id) on delete restrict,
  add constraint sales_discount_snapshot_length check (discount_name_snapshot is null or char_length(discount_name_snapshot) between 1 and 100),
  add constraint sales_tax_snapshot_length check (tax_name_snapshot is null or char_length(tax_name_snapshot) between 1 and 100),
  add constraint sales_dining_snapshot_length check (dining_option_name_snapshot is null or char_length(dining_option_name_snapshot) between 1 and 60);

alter table public.sale_items
  add column modifier_total_minor bigint not null default 0,
  add column modifiers_snapshot jsonb not null default '[]'::jsonb,
  add constraint sale_items_modifier_total_nonnegative check (modifier_total_minor >= 0),
  add constraint sale_items_modifiers_snapshot_array check (jsonb_typeof(modifiers_snapshot) = 'array');

alter table public.discounts enable row level security;
alter table public.tax_rates enable row level security;
alter table public.dining_options enable row level security;
alter table public.modifier_groups enable row level security;
alter table public.modifier_options enable row level security;
alter table public.product_modifier_groups enable row level security;
alter table public.open_tickets enable row level security;
alter table public.advanced_checkout_requests enable row level security;

revoke all on table public.discounts, public.tax_rates, public.dining_options,
  public.modifier_groups, public.modifier_options, public.product_modifier_groups,
  public.open_tickets, public.advanced_checkout_requests from public, anon, service_role;
grant select, insert, update on table public.discounts, public.tax_rates, public.dining_options,
  public.modifier_groups, public.modifier_options, public.product_modifier_groups to authenticated;
grant select on table public.open_tickets to authenticated;

create policy discounts_select_sales_or_manager on public.discounts for select to authenticated
  using ((select private.has_permission(organization_id, 'sales.create')) or (select private.has_permission(organization_id, 'products.manage')));
create policy discounts_manage_authorized on public.discounts for all to authenticated
  using ((select private.has_permission(organization_id, 'products.manage')))
  with check ((select private.has_permission(organization_id, 'products.manage')));
create policy tax_rates_select_sales_or_manager on public.tax_rates for select to authenticated
  using ((select private.has_permission(organization_id, 'sales.create')) or (select private.has_permission(organization_id, 'products.manage')));
create policy tax_rates_manage_authorized on public.tax_rates for all to authenticated
  using ((select private.has_permission(organization_id, 'products.manage')))
  with check ((select private.has_permission(organization_id, 'products.manage')));
create policy dining_options_select_sales_or_manager on public.dining_options for select to authenticated
  using ((select private.has_permission(organization_id, 'sales.create')) or (select private.has_permission(organization_id, 'products.manage')));
create policy dining_options_manage_authorized on public.dining_options for all to authenticated
  using ((select private.has_permission(organization_id, 'products.manage')))
  with check ((select private.has_permission(organization_id, 'products.manage')));
create policy modifier_groups_select_sales_or_manager on public.modifier_groups for select to authenticated
  using ((select private.has_permission(organization_id, 'sales.create')) or (select private.has_permission(organization_id, 'products.manage')));
create policy modifier_groups_manage_authorized on public.modifier_groups for all to authenticated
  using ((select private.has_permission(organization_id, 'products.manage')))
  with check ((select private.has_permission(organization_id, 'products.manage')));
create policy modifier_options_select_sales_or_manager on public.modifier_options for select to authenticated
  using ((select private.has_permission(organization_id, 'sales.create')) or (select private.has_permission(organization_id, 'products.manage')));
create policy modifier_options_manage_authorized on public.modifier_options for all to authenticated
  using ((select private.has_permission(organization_id, 'products.manage')))
  with check ((select private.has_permission(organization_id, 'products.manage')));
create policy product_modifier_groups_select_sales_or_manager on public.product_modifier_groups for select to authenticated
  using ((select private.has_permission(organization_id, 'sales.create')) or (select private.has_permission(organization_id, 'products.manage')));
create policy product_modifier_groups_manage_authorized on public.product_modifier_groups for all to authenticated
  using ((select private.has_permission(organization_id, 'products.manage')))
  with check ((select private.has_permission(organization_id, 'products.manage')));
create policy open_tickets_select_sales_authorized on public.open_tickets for select to authenticated
  using ((select private.has_permission(organization_id, 'sales.create')));

create trigger discounts_set_updated_at before update on public.discounts for each row execute function private.set_updated_at();
create trigger tax_rates_set_updated_at before update on public.tax_rates for each row execute function private.set_updated_at();
create trigger dining_options_set_updated_at before update on public.dining_options for each row execute function private.set_updated_at();
create trigger modifier_groups_set_updated_at before update on public.modifier_groups for each row execute function private.set_updated_at();
create trigger modifier_options_set_updated_at before update on public.modifier_options for each row execute function private.set_updated_at();
create trigger open_tickets_set_updated_at before update on public.open_tickets for each row execute function private.set_updated_at();

create or replace function public.get_pos_product_modifiers(
  target_organization_id uuid,
  target_product_id uuid
)
returns table (
  group_id uuid,
  group_name text,
  min_selections smallint,
  max_selections smallint,
  options jsonb
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;

  return query
  select
    modifier_group.id,
    modifier_group.name,
    modifier_group.min_selections,
    modifier_group.max_selections,
    coalesce(jsonb_agg(jsonb_build_object(
      'id', modifier_option.id,
      'name', modifier_option.name,
      'price_minor', modifier_option.price_adjustment_minor
    ) order by modifier_option.sort_order, lower(modifier_option.name)) filter (where modifier_option.id is not null), '[]'::jsonb)
  from public.product_modifier_groups assignment
  join public.modifier_groups modifier_group
    on modifier_group.id = assignment.modifier_group_id
   and modifier_group.organization_id = assignment.organization_id
   and modifier_group.is_active
  left join public.modifier_options modifier_option
    on modifier_option.modifier_group_id = modifier_group.id
   and modifier_option.organization_id = modifier_group.organization_id
   and modifier_option.is_active
  where assignment.organization_id = target_organization_id
    and assignment.product_id = target_product_id
  group by modifier_group.id, modifier_group.name, modifier_group.min_selections, modifier_group.max_selections, assignment.sort_order
  order by assignment.sort_order, lower(modifier_group.name);
end;
$$;

create or replace function private.validate_advanced_cart(
  target_organization_id uuid,
  target_store_id uuid,
  target_cart jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_items jsonb;
begin
  if target_cart is null or jsonb_typeof(target_cart) <> 'array'
    or jsonb_array_length(target_cart) not between 1 and 100 then
    raise exception 'An open ticket must contain between 1 and 100 items.' using errcode = '23514';
  end if;

  select jsonb_agg(jsonb_build_object(
    'product_id', line.value -> 'product_id',
    'variant_id', coalesce(line.value -> 'variant_id', 'null'::jsonb),
    'quantity', line.value -> 'quantity'
  ) order by line.ordinality)
  into normalized_items
  from jsonb_array_elements(target_cart) with ordinality as line(value, ordinality);

  perform private.quote_checkout_subtotal(target_organization_id, target_store_id, normalized_items);
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
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  normalized_label text := nullif(btrim(target_label), '');
  normalized_note text := nullif(btrim(target_note), '');
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;
  if normalized_label is null or char_length(normalized_label) > 100
    or (normalized_note is not null and char_length(normalized_note) > 500) then
    raise exception 'Enter a ticket label up to 100 characters and an optional note up to 500 characters.' using errcode = '23514';
  end if;

  select employee.id into actor_employee_id
  from public.employees employee
  join public.employee_stores employee_store on employee_store.employee_id = employee.id and employee_store.organization_id = employee.organization_id and employee_store.store_id = target_store_id
  join public.registers register on register.id = target_register_id and register.organization_id = employee.organization_id and register.store_id = target_store_id and register.is_active
  where employee.organization_id = target_organization_id and employee.profile_id = (select auth.uid()) and employee.status = 'active';
  if actor_employee_id is null then
    raise exception 'An active assigned employee and register are required.' using errcode = '42501';
  end if;

  perform private.validate_advanced_cart(target_organization_id, target_store_id, target_cart);
  if target_customer_id is not null and not exists (
    select 1 from public.customers customer where customer.id = target_customer_id and customer.organization_id = target_organization_id and customer.status = 'active'
  ) then raise exception 'The selected customer is not active in this organization.' using errcode = '23514'; end if;
  if target_dining_option_id is not null and not exists (
    select 1 from public.dining_options option where option.id = target_dining_option_id and option.organization_id = target_organization_id and option.is_active
  ) then raise exception 'The selected dining option is not active.' using errcode = '23514'; end if;

  if target_ticket_id is null then
    return query
    insert into public.open_tickets (organization_id, store_id, register_id, opened_by_employee_id, customer_id, dining_option_id, label, note, cart)
    values (target_organization_id, target_store_id, target_register_id, actor_employee_id, target_customer_id, target_dining_option_id, normalized_label, normalized_note, target_cart)
    returning id, created_at, updated_at;
  end if;

  return query
  update public.open_tickets ticket
  set customer_id = target_customer_id, dining_option_id = target_dining_option_id, label = normalized_label, note = normalized_note, cart = target_cart
  where ticket.id = target_ticket_id and ticket.organization_id = target_organization_id and ticket.store_id = target_store_id and ticket.register_id = target_register_id and ticket.status = 'open'
  returning ticket.id, ticket.created_at, ticket.updated_at;
  if not found then raise exception 'This open ticket is no longer available.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.save_open_ticket(uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb)
returns table (ticket_id uuid, created_at timestamptz, updated_at timestamptz)
language sql security invoker set search_path = '' as $$
  select * from private.save_open_ticket($1, $2, $3, $4, $5, $6, $7, $8, $9);
$$;

create or replace function private.cancel_open_ticket(target_organization_id uuid, target_ticket_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;
  update public.open_tickets set status = 'cancelled'
  where id = target_ticket_id and organization_id = target_organization_id and status = 'open';
  if not found then raise exception 'This open ticket is no longer available.' using errcode = 'P0002'; end if;
end;
$$;
create or replace function public.cancel_open_ticket(uuid, uuid)
returns void language sql security invoker set search_path = '' as $$ select private.cancel_open_ticket($1, $2); $$;

create or replace function private.checkout_advanced_sale(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_idempotency_key uuid,
  target_items jsonb,
  target_payments jsonb,
  target_customer_id uuid,
  target_loyalty_redemption_points integer,
  target_discount_id uuid,
  target_tax_rate_id uuid,
  target_dining_option_id uuid,
  target_open_ticket_id uuid
)
returns table (sale_id uuid, receipt_number bigint, total_minor bigint, change_minor bigint, payment_summary jsonb, was_replayed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  actor_employee_id uuid; existing_request public.advanced_checkout_requests%rowtype; request_payload jsonb;
  selected_customer public.customers%rowtype; loyalty_program public.loyalty_programs%rowtype;
  selected_discount public.discounts%rowtype; selected_tax public.tax_rates%rowtype; selected_dining public.dining_options%rowtype;
  selected_ticket public.open_tickets%rowtype; selected_fake_method record; selected_payment record;
  normalized_items jsonb; quoted_lines jsonb := '[]'::jsonb; line jsonb; option_ids jsonb; option_snapshot jsonb;
  product_name text; variant_name text; sku text; item_unit text; base_price bigint; modifier_price bigint; quantity integer;
  subtotal bigint := 0; discount_total bigint := 0; tax_total bigint := 0; grand_total bigint; tax_inclusive boolean := false;
  loyalty_payment_method_id uuid; redemption_minor bigint := 0; earned_points integer := 0; customer_balance integer := 0;
  decorated_payments jsonb; synthetic_payment jsonb; synthetic_key uuid; checkout_result record; new_payment_summary jsonb := '[]'::jsonb;
  paid_total bigint := 0; change_total bigint := 0; remaining bigint; applied bigint; tendered bigint; payment_change bigint;
  payment_method_id uuid; payment_name text; payment_code text; payment_type text; payment_requires_reference boolean; payment_is_loyalty boolean;
  payment_reference text; payment_note text; requested_amount bigint; receipt_value bigint;
begin
  if target_organization_id is null or target_store_id is null or target_register_id is null or target_idempotency_key is null then
    raise exception 'A store, register, and checkout key are required.' using errcode = '23514';
  end if;
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;
  if target_items is null or jsonb_typeof(target_items) <> 'array' or jsonb_array_length(target_items) not between 1 and 100
    or target_payments is null or jsonb_typeof(target_payments) <> 'array' or jsonb_array_length(target_payments) not between 1 and 10 then
    raise exception 'Checkout items and payments must contain between 1 and their supported limit.' using errcode = '23514';
  end if;
  if coalesce(target_loyalty_redemption_points, 0) not between 0 and 100000000 then
    raise exception 'Loyalty redemption points must be between 0 and 100,000,000.' using errcode = '23514';
  end if;

  select employee.id into actor_employee_id from public.employees employee
  join public.employee_stores es on es.employee_id = employee.id and es.organization_id = employee.organization_id and es.store_id = target_store_id
  join public.registers register on register.id = target_register_id and register.organization_id = employee.organization_id and register.store_id = target_store_id and register.is_active
  where employee.organization_id = target_organization_id and employee.profile_id = (select auth.uid()) and employee.status = 'active';
  if actor_employee_id is null then raise exception 'An active assigned employee and register are required.' using errcode = '42501'; end if;

  request_payload := jsonb_build_object('items', target_items, 'payments', target_payments, 'store_id', target_store_id, 'register_id', target_register_id, 'customer_id', target_customer_id, 'loyalty_redemption_points', coalesce(target_loyalty_redemption_points, 0), 'discount_id', target_discount_id, 'tax_rate_id', target_tax_rate_id, 'dining_option_id', target_dining_option_id, 'open_ticket_id', target_open_ticket_id);
  select * into existing_request from public.advanced_checkout_requests request where request.organization_id = target_organization_id and request.idempotency_key = target_idempotency_key for update;
  if found then
    if existing_request.actor_employee_id is distinct from actor_employee_id or existing_request.request_payload is distinct from request_payload then raise exception 'This checkout key was already used for a different request.' using errcode = '23505'; end if;
    if existing_request.sale_id is null then raise exception 'The prior checkout did not finish. Try again with a new checkout key.' using errcode = '40001'; end if;
    select receipt.receipt_number into receipt_value from public.receipts receipt where receipt.sale_id = existing_request.sale_id and receipt.organization_id = target_organization_id;
    select coalesce(jsonb_agg(jsonb_build_object('payment_method_id', payment.payment_method_id, 'name', payment.payment_method_name_snapshot, 'code', payment.payment_method_code_snapshot, 'type', payment.payment_method_type_snapshot, 'amount_minor', payment.amount_minor, 'amount_tendered_minor', payment.amount_tendered_minor, 'change_given_minor', payment.change_given_minor, 'reference_number', payment.reference_number, 'note', payment.note) order by payment.created_at, payment.id), '[]'::jsonb) into new_payment_summary from public.payments payment where payment.sale_id = existing_request.sale_id and payment.organization_id = target_organization_id;
    return query select sale.id, receipt_value, sale.total_minor, coalesce((select sum(payment.change_given_minor) from public.payments payment where payment.sale_id = sale.id), 0)::bigint, new_payment_summary, true from public.sales sale where sale.id = existing_request.sale_id and sale.organization_id = target_organization_id;
    return;
  end if;
  insert into public.advanced_checkout_requests (organization_id, actor_employee_id, idempotency_key, request_payload) values (target_organization_id, actor_employee_id, target_idempotency_key, request_payload);

  select jsonb_agg(jsonb_build_object('product_id', item.value -> 'product_id', 'variant_id', coalesce(item.value -> 'variant_id', 'null'::jsonb), 'quantity', item.value -> 'quantity') order by item.ordinality) into normalized_items from jsonb_array_elements(target_items) with ordinality item(value, ordinality);
  perform private.quote_checkout_subtotal(target_organization_id, target_store_id, normalized_items);

  for line in select value from jsonb_array_elements(target_items) loop
    if jsonb_typeof(line -> 'product_id') <> 'string' or coalesce(line ->> 'quantity', '') !~ '^[1-9][0-9]{0,3}$' then raise exception 'Each checkout item must have valid item references and quantity.' using errcode = '23514'; end if;
    quantity := (line ->> 'quantity')::integer;
    if nullif(line ->> 'variant_id', '') is null then
      select product.name, null::text, product.sku, product.unit, product.price_minor into product_name, variant_name, sku, item_unit, base_price from public.products product join public.product_store_settings setting on setting.organization_id = product.organization_id and setting.product_id = product.id and setting.store_id = target_store_id and setting.is_available where product.id = (line ->> 'product_id')::uuid and product.organization_id = target_organization_id and product.status = 'active' and product.product_type = 'simple';
    else
      select product.name, variant.name, variant.sku, product.unit, variant.price_minor into product_name, variant_name, sku, item_unit, base_price from public.products product join public.product_store_settings setting on setting.organization_id = product.organization_id and setting.product_id = product.id and setting.store_id = target_store_id and setting.is_available join public.product_variants variant on variant.id = (line ->> 'variant_id')::uuid and variant.product_id = product.id and variant.organization_id = product.organization_id and variant.is_active where product.id = (line ->> 'product_id')::uuid and product.organization_id = target_organization_id and product.status = 'active' and product.product_type = 'variable';
    end if;
    if base_price is null then raise exception 'Every checkout item must be active and available at this store.' using errcode = '23514'; end if;
    option_ids := coalesce(line -> 'modifier_option_ids', '[]'::jsonb);
    if jsonb_typeof(option_ids) <> 'array' or jsonb_array_length(option_ids) > 50 or exists (select 1 from jsonb_array_elements(option_ids) option where jsonb_typeof(option) <> 'string' or option #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then raise exception 'Modifier selections are invalid.' using errcode = '23514'; end if;
    if (select count(*) from jsonb_array_elements_text(option_ids)) <> (select count(distinct value) from jsonb_array_elements_text(option_ids)) then raise exception 'Choose each modifier option only once.' using errcode = '23514'; end if;
    if exists (select 1 from jsonb_array_elements_text(option_ids) selected(option_id) left join public.modifier_options option on option.id = selected.option_id::uuid and option.organization_id = target_organization_id and option.is_active left join public.product_modifier_groups assignment on assignment.modifier_group_id = option.modifier_group_id and assignment.organization_id = option.organization_id and assignment.product_id = (line ->> 'product_id')::uuid where option.id is null or assignment.product_id is null) then raise exception 'One or more modifiers are unavailable for this product.' using errcode = '23514'; end if;
    if exists (select 1 from public.product_modifier_groups assignment join public.modifier_groups grp on grp.id = assignment.modifier_group_id and grp.organization_id = assignment.organization_id and grp.is_active left join public.modifier_options option on option.modifier_group_id = grp.id and option.organization_id = grp.organization_id and option.is_active and option.id in (select value::uuid from jsonb_array_elements_text(option_ids)) where assignment.organization_id = target_organization_id and assignment.product_id = (line ->> 'product_id')::uuid group by grp.id, grp.min_selections, grp.max_selections having count(option.id) < grp.min_selections or count(option.id) > grp.max_selections) then raise exception 'Choose the required number of options for each modifier group.' using errcode = '23514'; end if;
    select coalesce(sum(option.price_adjustment_minor), 0)::bigint, coalesce(jsonb_agg(jsonb_build_object('id', option.id, 'name', option.name, 'price_adjustment_minor', option.price_adjustment_minor) order by option.sort_order, lower(option.name)), '[]'::jsonb) into modifier_price, option_snapshot from public.modifier_options option where option.id in (select value::uuid from jsonb_array_elements_text(option_ids));
    subtotal := subtotal + (base_price + modifier_price) * quantity;
    quoted_lines := quoted_lines || jsonb_build_array(jsonb_build_object('product_id', line ->> 'product_id', 'variant_id', nullif(line ->> 'variant_id', ''), 'quantity', quantity, 'product_name', product_name, 'variant_name', variant_name, 'sku', sku, 'unit', item_unit, 'base_price_minor', base_price, 'modifier_total_minor', modifier_price, 'modifiers', option_snapshot));
  end loop;
  if subtotal <= 0 then raise exception 'A checkout total must be greater than zero.' using errcode = '23514'; end if;

  if target_discount_id is not null then select * into selected_discount from public.discounts discount where discount.id = target_discount_id and discount.organization_id = target_organization_id and discount.is_active for key share; if selected_discount.id is null then raise exception 'The selected discount is not active.' using errcode = '23514'; end if; discount_total := case when selected_discount.discount_type = 'percentage' then round(subtotal::numeric * selected_discount.percentage_bps / 10000)::bigint else selected_discount.amount_minor end; discount_total := least(discount_total, subtotal); end if;
  if target_tax_rate_id is not null then select * into selected_tax from public.tax_rates tax where tax.id = target_tax_rate_id and tax.organization_id = target_organization_id and tax.is_active for key share; elsif exists (select 1 from public.tax_rates tax where tax.organization_id = target_organization_id and tax.is_active and tax.is_default) then select * into selected_tax from public.tax_rates tax where tax.organization_id = target_organization_id and tax.is_active and tax.is_default for key share; end if;
  if selected_tax.id is not null then tax_inclusive := selected_tax.is_inclusive; tax_total := case when tax_inclusive then round((subtotal - discount_total)::numeric * selected_tax.rate_bps / (10000 + selected_tax.rate_bps))::bigint else round((subtotal - discount_total)::numeric * selected_tax.rate_bps / 10000)::bigint end; end if;
  grand_total := subtotal - discount_total + case when tax_inclusive then 0 else tax_total end;
  if grand_total <= 0 then raise exception 'The discount leaves no balance to collect.' using errcode = '23514'; end if;
  if target_dining_option_id is not null then select * into selected_dining from public.dining_options option where option.id = target_dining_option_id and option.organization_id = target_organization_id and option.is_active for key share; if selected_dining.id is null then raise exception 'The selected dining option is not active.' using errcode = '23514'; end if; end if;
  if target_open_ticket_id is not null then select * into selected_ticket from public.open_tickets ticket where ticket.id = target_open_ticket_id and ticket.organization_id = target_organization_id and ticket.store_id = target_store_id and ticket.register_id = target_register_id and ticket.status = 'open' for update; if selected_ticket.id is null then raise exception 'The selected open ticket is no longer available.' using errcode = '23514'; end if; end if;

  if target_customer_id is null and coalesce(target_loyalty_redemption_points, 0) > 0 then raise exception 'Assign a customer before redeeming loyalty points.' using errcode = '23514'; end if;
  if target_customer_id is not null then
    select * into selected_customer from public.customers customer where customer.id = target_customer_id and customer.organization_id = target_organization_id and customer.status = 'active' for update; if selected_customer.id is null then raise exception 'The selected customer is not active in this organization.' using errcode = '23514'; end if;
    select * into loyalty_program from public.loyalty_programs program where program.organization_id = target_organization_id for key share;
    if coalesce(target_loyalty_redemption_points, 0) > 0 then
      if loyalty_program.organization_id is null or not loyalty_program.is_enabled then raise exception 'Loyalty redemption is currently disabled.' using errcode = '23514'; end if;
      if target_loyalty_redemption_points < loyalty_program.minimum_redemption_points then raise exception 'This redemption is below the program minimum.' using errcode = '23514'; end if;
      select coalesce(sum(transaction.points_delta), 0)::integer into customer_balance from public.loyalty_transactions transaction where transaction.organization_id = target_organization_id and transaction.customer_id = target_customer_id; if customer_balance < target_loyalty_redemption_points then raise exception 'The customer does not have enough loyalty points.' using errcode = '23514'; end if;
      redemption_minor := target_loyalty_redemption_points::bigint * loyalty_program.redemption_value_minor; if redemption_minor > grand_total then raise exception 'Loyalty points cannot exceed this sale total.' using errcode = '23514'; end if;
      select method.id into loyalty_payment_method_id from public.payment_methods method join public.store_payment_methods store_method on store_method.organization_id = method.organization_id and store_method.payment_method_id = method.id and store_method.store_id = target_store_id and store_method.is_enabled where method.organization_id = target_organization_id and method.is_loyalty_redemption and method.is_enabled for key share; if loyalty_payment_method_id is null then raise exception 'Loyalty redemption is not enabled for this store.' using errcode = '23514'; end if;
    end if;
  end if;
  if redemption_minor > 0 then
    if jsonb_array_length(target_payments) >= 10 then raise exception 'Use at most nine customer payment entries when redeeming loyalty points.' using errcode = '23514'; end if;
    decorated_payments := jsonb_build_array(jsonb_build_object('payment_method_id', loyalty_payment_method_id, 'amount_minor', redemption_minor, '_tindio_loyalty', true)) || target_payments;
  else decorated_payments := target_payments; end if;

  select method.id, method.payment_type, method.requires_reference into selected_fake_method from public.payment_methods method join public.store_payment_methods store_method on store_method.organization_id = method.organization_id and store_method.payment_method_id = method.id and store_method.store_id = target_store_id and store_method.is_enabled where method.organization_id = target_organization_id and method.is_enabled and not method.is_loyalty_redemption order by method.sort_order, method.created_at limit 1 for key share; if selected_fake_method.id is null then raise exception 'No standard payment method is enabled for this store.' using errcode = '23514'; end if;
  synthetic_payment := jsonb_build_object('payment_method_id', selected_fake_method.id) || case when selected_fake_method.payment_type = 'CASH' then jsonb_build_object('amount_tendered_minor', private.quote_checkout_subtotal(target_organization_id, target_store_id, normalized_items)) else jsonb_build_object('amount_minor', private.quote_checkout_subtotal(target_organization_id, target_store_id, normalized_items)) end || case when selected_fake_method.requires_reference then jsonb_build_object('reference_number', 'TINDIO-INTERNAL') else '{}'::jsonb end;
  synthetic_key := (substr(md5('tindio-advanced:' || target_idempotency_key::text), 1, 8) || '-' || substr(md5('tindio-advanced:' || target_idempotency_key::text), 9, 4) || '-' || substr(md5('tindio-advanced:' || target_idempotency_key::text), 13, 4) || '-' || substr(md5('tindio-advanced:' || target_idempotency_key::text), 17, 4) || '-' || substr(md5('tindio-advanced:' || target_idempotency_key::text), 21, 12))::uuid;
  select * into checkout_result from private.checkout_sale(target_organization_id, target_store_id, target_register_id, synthetic_key, normalized_items, jsonb_build_array(synthetic_payment));
  if checkout_result.was_replayed then raise exception 'The internal checkout was unexpectedly replayed. Start a new checkout.' using errcode = '40001'; end if;

  delete from public.payments where sale_id = checkout_result.sale_id and organization_id = target_organization_id;
  delete from public.sale_items where sale_id = checkout_result.sale_id and organization_id = target_organization_id;
  for line in select value from jsonb_array_elements(quoted_lines) loop
    insert into public.sale_items (organization_id, sale_id, product_id, variant_id, product_name_snapshot, variant_name_snapshot, sku_snapshot, unit_snapshot, quantity, unit_price_minor, modifier_total_minor, modifiers_snapshot, line_total_minor)
    values (target_organization_id, checkout_result.sale_id, (line ->> 'product_id')::uuid, nullif(line ->> 'variant_id', '')::uuid, line ->> 'product_name', nullif(line ->> 'variant_name', ''), nullif(line ->> 'sku', ''), line ->> 'unit', (line ->> 'base_price_minor')::bigint + (line ->> 'modifier_total_minor')::bigint, (line ->> 'modifier_total_minor')::bigint, line -> 'modifiers', ((line ->> 'base_price_minor')::bigint + (line ->> 'modifier_total_minor')::bigint) * (line ->> 'quantity')::integer);
  end loop;
  update public.sales sale set subtotal_minor = subtotal, discount_minor = discount_total, tax_minor = tax_total, tax_is_inclusive = tax_inclusive, total_minor = grand_total, discount_id = selected_discount.id, discount_name_snapshot = selected_discount.name, tax_rate_id = selected_tax.id, tax_name_snapshot = selected_tax.name, dining_option_id = selected_dining.id, dining_option_name_snapshot = selected_dining.name, open_ticket_id = selected_ticket.id, customer_id = target_customer_id, loyalty_redemption_minor = redemption_minor, loyalty_points_redeemed = coalesce(target_loyalty_redemption_points, 0) where sale.id = checkout_result.sale_id and sale.organization_id = target_organization_id;

  for selected_payment in select value, ordinality from jsonb_array_elements(decorated_payments) with ordinality payment(value, ordinality) order by ordinality loop
    remaining := grand_total - paid_total; if remaining <= 0 then raise exception 'No additional payment is needed for this sale.' using errcode = '23514'; end if;
    if jsonb_typeof(selected_payment.value -> 'payment_method_id') <> 'string' then raise exception 'Each payment must include a valid payment method.' using errcode = '23514'; end if;
    payment_method_id := (selected_payment.value ->> 'payment_method_id')::uuid;
    select method.name, method.code, method.payment_type, method.requires_reference, method.is_loyalty_redemption into payment_name, payment_code, payment_type, payment_requires_reference, payment_is_loyalty from public.payment_methods method join public.store_payment_methods store_method on store_method.organization_id = method.organization_id and store_method.payment_method_id = method.id and store_method.store_id = target_store_id and store_method.is_enabled where method.id = payment_method_id and method.organization_id = target_organization_id and method.is_enabled for key share;
    if payment_name is null then raise exception 'That payment method is not enabled for this store.' using errcode = '23514'; end if;
    if payment_is_loyalty and (selected_payment.ordinality <> 1 or redemption_minor = 0 or payment_method_id <> loyalty_payment_method_id or not coalesce((selected_payment.value ->> '_tindio_loyalty')::boolean, false)) then raise exception 'Loyalty payment can only be created from a validated redemption.' using errcode = '23514'; end if;
    if not payment_is_loyalty and selected_payment.value ? '_tindio_loyalty' then raise exception 'Invalid payment method.' using errcode = '23514'; end if;
    payment_reference := nullif(btrim(selected_payment.value ->> 'reference_number'), ''); payment_note := nullif(btrim(selected_payment.value ->> 'note'), ''); if payment_requires_reference and payment_reference is null then raise exception 'A reference number is required for the selected payment method.' using errcode = '23514'; end if;
    if payment_type = 'CASH' then tendered := nullif(selected_payment.value ->> 'amount_tendered_minor', '')::bigint; if tendered is null or tendered <= 0 then raise exception 'Cash tender is required.' using errcode = '23514'; end if; applied := least(tendered, remaining); payment_change := tendered - applied; else requested_amount := nullif(selected_payment.value ->> 'amount_minor', '')::bigint; if requested_amount is null or requested_amount <= 0 or requested_amount > remaining then raise exception 'Payment amount must be greater than zero and no more than the remaining balance.' using errcode = '23514'; end if; applied := requested_amount; tendered := null; payment_change := null; end if;
    insert into public.payments (organization_id, sale_id, payment_method_id, payment_method_name_snapshot, payment_method_code_snapshot, payment_method_type_snapshot, amount_minor, amount_tendered_minor, change_given_minor, reference_number, note) values (target_organization_id, checkout_result.sale_id, payment_method_id, payment_name, payment_code, payment_type, applied, tendered, payment_change, payment_reference, payment_note);
    paid_total := paid_total + applied; change_total := change_total + coalesce(payment_change, 0); new_payment_summary := new_payment_summary || jsonb_build_array(jsonb_build_object('payment_method_id', payment_method_id, 'name', payment_name, 'code', payment_code, 'type', payment_type, 'amount_minor', applied, 'amount_tendered_minor', tendered, 'change_given_minor', payment_change, 'reference_number', payment_reference, 'note', payment_note));
  end loop;
  if paid_total <> grand_total then raise exception 'Payments must exactly cover the sale total before completion.' using errcode = '23514'; end if;
  if target_customer_id is not null and loyalty_program.is_enabled then earned_points := floor((grand_total - redemption_minor)::numeric / loyalty_program.earn_spend_minor)::integer * loyalty_program.earn_points; update public.sales set loyalty_points_earned = earned_points where id = checkout_result.sale_id and organization_id = target_organization_id; if redemption_minor > 0 then insert into public.loyalty_transactions (organization_id, customer_id, sale_id, entry_type, points_delta, note) values (target_organization_id, target_customer_id, checkout_result.sale_id, 'REDEMPTION', -target_loyalty_redemption_points, 'Redeemed during advanced POS checkout'); end if; if earned_points > 0 then insert into public.loyalty_transactions (organization_id, customer_id, sale_id, entry_type, points_delta, note) values (target_organization_id, target_customer_id, checkout_result.sale_id, 'SALE_EARN', earned_points, 'Earned from advanced POS checkout'); end if; end if;
  if selected_ticket.id is not null then update public.open_tickets set status = 'completed', sale_id = checkout_result.sale_id where id = selected_ticket.id and organization_id = target_organization_id; end if;
  update public.advanced_checkout_requests set state = 'completed', sale_id = checkout_result.sale_id, completed_at = now() where organization_id = target_organization_id and idempotency_key = target_idempotency_key;
  return query select checkout_result.sale_id, checkout_result.receipt_number, grand_total, change_total, new_payment_summary, false;
end;
$$;

create or replace function public.checkout_advanced_sale(uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, integer, uuid, uuid, uuid, uuid)
returns table (sale_id uuid, receipt_number bigint, total_minor bigint, change_minor bigint, payment_summary jsonb, was_replayed boolean)
language sql security invoker set search_path = '' as $$
  select * from private.checkout_advanced_sale($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);
$$;

revoke execute on function private.validate_advanced_cart(uuid, uuid, jsonb), private.save_open_ticket(uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb), private.cancel_open_ticket(uuid, uuid), private.checkout_advanced_sale(uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, integer, uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.get_pos_product_modifiers(uuid, uuid), public.save_open_ticket(uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb), public.cancel_open_ticket(uuid, uuid), public.checkout_advanced_sale(uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, integer, uuid, uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.get_pos_product_modifiers(uuid, uuid), public.save_open_ticket(uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb), public.cancel_open_ticket(uuid, uuid), public.checkout_advanced_sale(uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, integer, uuid, uuid, uuid, uuid) to authenticated;

comment on function public.checkout_advanced_sale(uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, integer, uuid, uuid, uuid, uuid)
is 'Phase 8 checkout: validates modifiers, discounts, tax, loyalty, split payments, dining option, and an optional held ticket before committing immutable sale snapshots.';

commit;
