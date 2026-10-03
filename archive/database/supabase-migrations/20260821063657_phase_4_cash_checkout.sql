-- TINDIO Phase 4: transaction-safe cash checkout, immutable sales, and receipts.
-- The public RPC accepts only item references, quantities, tendered cash, and an
-- idempotency key. Prices, totals, receipt numbers, and stock movements are
-- resolved and committed together inside the private transaction boundary.

begin;

create sequence private.tindio_receipt_number_sequence
  as bigint
  start with 1
  increment by 1
  minvalue 1
  no maxvalue
  cache 1;

revoke all on sequence private.tindio_receipt_number_sequence
from public, anon, authenticated, service_role;

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  store_id uuid not null,
  register_id uuid not null,
  cashier_employee_id uuid not null,
  status text not null default 'completed',
  currency_code text not null,
  organization_name_snapshot text not null,
  store_name_snapshot text not null,
  register_name_snapshot text not null,
  cashier_name_snapshot text not null,
  subtotal_minor bigint not null default 0,
  discount_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  total_minor bigint not null default 0,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint sales_id_organization_unique unique (id, organization_id),
  constraint sales_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id)
    on delete restrict,
  constraint sales_register_organization_fkey
    foreign key (register_id, organization_id)
    references public.registers (id, organization_id)
    on delete restrict,
  constraint sales_cashier_organization_fkey
    foreign key (cashier_employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete restrict,
  constraint sales_status_values check (status = 'completed'),
  constraint sales_currency_code_format check (currency_code ~ '^[A-Z]{3}$'),
  constraint sales_organization_name_snapshot_length check (
    char_length(organization_name_snapshot) between 2 and 160
  ),
  constraint sales_store_name_snapshot_length check (
    char_length(store_name_snapshot) between 2 and 160
  ),
  constraint sales_register_name_snapshot_length check (
    char_length(register_name_snapshot) between 2 and 160
  ),
  constraint sales_cashier_name_snapshot_length check (
    char_length(cashier_name_snapshot) between 1 and 320
  ),
  constraint sales_amounts_nonnegative check (
    subtotal_minor >= 0
    and discount_minor >= 0
    and tax_minor >= 0
    and total_minor >= 0
  ),
  constraint sales_total_math check (
    total_minor = subtotal_minor - discount_minor + tax_minor
  )
);

create index sales_organization_store_completed_idx
  on public.sales (organization_id, store_id, completed_at desc);
create index sales_cashier_employee_completed_idx
  on public.sales (cashier_employee_id, completed_at desc);
create index sales_register_completed_idx
  on public.sales (register_id, completed_at desc);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  sale_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  product_name_snapshot text not null,
  variant_name_snapshot text,
  sku_snapshot text,
  unit_snapshot text not null,
  quantity integer not null,
  unit_price_minor bigint not null,
  discount_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  line_total_minor bigint not null,
  created_at timestamptz not null default now(),
  constraint sale_items_sale_organization_fkey
    foreign key (sale_id, organization_id)
    references public.sales (id, organization_id)
    on delete restrict,
  constraint sale_items_product_organization_fkey
    foreign key (product_id, organization_id)
    references public.products (id, organization_id)
    on delete restrict,
  constraint sale_items_variant_product_organization_fkey
    foreign key (variant_id, product_id, organization_id)
    references public.product_variants (id, product_id, organization_id)
    on delete restrict,
  constraint sale_items_product_name_snapshot_length check (
    char_length(product_name_snapshot) between 1 and 160
  ),
  constraint sale_items_variant_name_snapshot_length check (
    variant_name_snapshot is null or char_length(variant_name_snapshot) between 1 and 160
  ),
  constraint sale_items_sku_snapshot_length check (
    sku_snapshot is null or char_length(sku_snapshot) between 1 and 64
  ),
  constraint sale_items_unit_snapshot_length check (
    char_length(unit_snapshot) between 1 and 24
  ),
  constraint sale_items_quantity_bounds check (quantity between 1 and 10000),
  constraint sale_items_amounts_nonnegative check (
    unit_price_minor >= 0
    and discount_minor >= 0
    and tax_minor >= 0
    and line_total_minor >= 0
  ),
  constraint sale_items_total_math check (
    line_total_minor = unit_price_minor * quantity - discount_minor + tax_minor
  )
);

create index sale_items_sale_id_idx on public.sale_items (sale_id);
create index sale_items_organization_product_idx
  on public.sale_items (organization_id, product_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  sale_id uuid not null,
  payment_method text not null,
  amount_minor bigint not null,
  cash_tendered_minor bigint,
  cash_change_minor bigint,
  created_at timestamptz not null default now(),
  constraint payments_sale_organization_fkey
    foreign key (sale_id, organization_id)
    references public.sales (id, organization_id)
    on delete restrict,
  constraint payments_method_values check (payment_method = 'cash'),
  constraint payments_amounts_nonnegative check (
    amount_minor >= 0
    and cash_tendered_minor >= 0
    and cash_change_minor >= 0
  ),
  constraint payments_cash_values_required check (
    payment_method <> 'cash'
    or (cash_tendered_minor is not null and cash_change_minor is not null)
  ),
  constraint payments_cash_math check (
    payment_method <> 'cash'
    or cash_tendered_minor - cash_change_minor = amount_minor
  )
);

create index payments_sale_id_idx on public.payments (sale_id);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  sale_id uuid not null,
  receipt_number bigint not null,
  issued_at timestamptz not null default now(),
  constraint receipts_sale_organization_fkey
    foreign key (sale_id, organization_id)
    references public.sales (id, organization_id)
    on delete restrict,
  constraint receipts_sale_unique unique (sale_id),
  constraint receipts_organization_number_unique unique (organization_id, receipt_number),
  constraint receipts_number_positive check (receipt_number > 0)
);

create index receipts_organization_issued_idx
  on public.receipts (organization_id, issued_at desc);

create table public.checkout_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  actor_employee_id uuid not null,
  idempotency_key uuid not null,
  request_payload jsonb not null,
  state text not null default 'processing',
  sale_id uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint checkout_requests_actor_organization_fkey
    foreign key (actor_employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete restrict,
  constraint checkout_requests_sale_organization_fkey
    foreign key (sale_id, organization_id)
    references public.sales (id, organization_id)
    on delete restrict,
  constraint checkout_requests_organization_key_unique
    unique (organization_id, idempotency_key),
  constraint checkout_requests_payload_object check (jsonb_typeof(request_payload) = 'object'),
  constraint checkout_requests_state_values check (state in ('processing', 'completed')),
  constraint checkout_requests_completion_state check (
    (state = 'processing' and sale_id is null and completed_at is null)
    or (state = 'completed' and sale_id is not null and completed_at is not null)
  )
);

create index checkout_requests_actor_created_idx
  on public.checkout_requests (actor_employee_id, created_at desc);
create unique index checkout_requests_sale_unique_idx
  on public.checkout_requests (sale_id)
  where sale_id is not null;

alter table public.inventory_movements
  drop constraint inventory_movements_type_values;

alter table public.inventory_movements
  add constraint inventory_movements_type_values check (
    movement_type in ('OPENING_STOCK', 'ADJUSTMENT', 'SALE')
  );

alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;
alter table public.receipts enable row level security;
alter table public.checkout_requests enable row level security;

revoke all on table public.sales, public.sale_items, public.payments,
  public.receipts, public.checkout_requests
from anon, authenticated;

grant select on table public.sales, public.sale_items, public.payments,
  public.receipts
to authenticated;

create policy sales_select_receipts_authorized
on public.sales
for select
to authenticated
using ((select private.has_permission(organization_id, 'receipts.view')));

create policy sale_items_select_receipts_authorized
on public.sale_items
for select
to authenticated
using ((select private.has_permission(organization_id, 'receipts.view')));

create policy payments_select_receipts_authorized
on public.payments
for select
to authenticated
using ((select private.has_permission(organization_id, 'receipts.view')));

create policy receipts_select_receipts_authorized
on public.receipts
for select
to authenticated
using ((select private.has_permission(organization_id, 'receipts.view')));

create or replace function private.checkout_cash_sale(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_cash_tendered_minor bigint,
  target_idempotency_key uuid,
  target_items jsonb
)
returns table (
  sale_id uuid,
  receipt_number bigint,
  total_minor bigint,
  cash_tendered_minor bigint,
  change_minor bigint,
  was_replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  organization_name_snapshot text;
  store_name_snapshot text;
  register_name_snapshot text;
  cashier_name_snapshot text;
  sale_currency_code text;
  checkout_request_id uuid;
  existing_actor_employee_id uuid;
  existing_payload jsonb;
  existing_sale_id uuid;
  canonical_payload jsonb;
  checkout_line record;
  product_name_snapshot text;
  variant_name_snapshot text;
  sku_snapshot text;
  unit_snapshot text;
  resolved_price_minor bigint;
  tracks_inventory boolean;
  current_quantity numeric(14, 3);
  next_quantity numeric(14, 3);
  next_line_total_minor bigint;
  calculated_subtotal_minor bigint := 0;
  new_sale_id uuid;
  new_receipt_number bigint;
begin
  if target_organization_id is null
    or target_store_id is null
    or target_register_id is null
    or target_idempotency_key is null then
    raise exception 'A store, register, and checkout key are required.'
      using errcode = '23514';
  end if;

  if target_cash_tendered_minor is null
    or target_cash_tendered_minor < 0
    or target_cash_tendered_minor > 1000000000000 then
    raise exception 'Cash tender must be a non-negative supported amount.'
      using errcode = '23514';
  end if;

  if target_items is null or jsonb_typeof(target_items) <> 'array' then
    raise exception 'Checkout items must be an array.' using errcode = '23514';
  end if;

  if jsonb_array_length(target_items) not between 1 and 100 then
    raise exception 'A checkout must contain between 1 and 100 items.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_items) as item(item_value)
    where jsonb_typeof(item.item_value) <> 'object'
      or jsonb_typeof(item.item_value -> 'product_id') <> 'string'
      or coalesce(item.item_value ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (
        item.item_value ? 'variant_id'
        and item.item_value -> 'variant_id' <> 'null'::jsonb
        and (
          jsonb_typeof(item.item_value -> 'variant_id') <> 'string'
          or coalesce(item.item_value ->> 'variant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
      )
      or coalesce(item.item_value ->> 'quantity', '') !~ '^[1-9][0-9]{0,3}$'
  ) then
    raise exception 'Each checkout item must have valid item references and quantity.'
      using errcode = '23514';
  end if;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;

  select
    employee.id,
    organization.name,
    store.name,
    register.name,
    coalesce(nullif(profile.full_name, ''), profile.email),
    organization.currency_code
  into
    actor_employee_id,
    organization_name_snapshot,
    store_name_snapshot,
    register_name_snapshot,
    cashier_name_snapshot,
    sale_currency_code
  from public.employees employee
  join public.employee_stores employee_store
    on employee_store.employee_id = employee.id
   and employee_store.organization_id = employee.organization_id
   and employee_store.store_id = target_store_id
  join public.organizations organization
    on organization.id = employee.organization_id
  join public.stores store
    on store.id = target_store_id
   and store.organization_id = employee.organization_id
   and store.is_active
  join public.registers register
    on register.id = target_register_id
   and register.store_id = store.id
   and register.organization_id = store.organization_id
   and register.is_active
  join public.profiles profile
    on profile.id = employee.profile_id
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active';

  if actor_employee_id is null then
    raise exception 'An active assigned employee and register are required.'
      using errcode = '42501';
  end if;

  canonical_payload := jsonb_build_object(
    'cash_tendered_minor', target_cash_tendered_minor,
    'items', target_items,
    'register_id', target_register_id,
    'store_id', target_store_id
  );

  insert into public.checkout_requests (
    organization_id,
    actor_employee_id,
    idempotency_key,
    request_payload
  )
  values (
    target_organization_id,
    actor_employee_id,
    target_idempotency_key,
    canonical_payload
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning id into checkout_request_id;

  if checkout_request_id is null then
    select
      request.actor_employee_id,
      request.request_payload,
      request.sale_id
    into
      existing_actor_employee_id,
      existing_payload,
      existing_sale_id
    from public.checkout_requests request
    where request.organization_id = target_organization_id
      and request.idempotency_key = target_idempotency_key
    for update;

    if existing_actor_employee_id is distinct from actor_employee_id
      or existing_payload is distinct from canonical_payload then
      raise exception 'This checkout key was already used for a different request.'
        using errcode = '23505';
    end if;

    if existing_sale_id is null then
      raise exception 'The prior checkout request did not complete. Try again with a new checkout key.'
        using errcode = '40001';
    end if;

    return query
    select
      completed_sale.id,
      receipt.receipt_number,
      completed_sale.total_minor,
      payment.cash_tendered_minor,
      payment.cash_change_minor,
      true
    from public.sales completed_sale
    join public.receipts receipt
      on receipt.sale_id = completed_sale.id
     and receipt.organization_id = completed_sale.organization_id
    join public.payments payment
      on payment.sale_id = completed_sale.id
     and payment.organization_id = completed_sale.organization_id
     and payment.payment_method = 'cash'
    where completed_sale.id = existing_sale_id
      and completed_sale.organization_id = target_organization_id;
    return;
  end if;

  if exists (
    with parsed_items as (
      select
        (item.item_value ->> 'product_id')::uuid as product_id,
        nullif(item.item_value ->> 'variant_id', '')::uuid as variant_id,
        (item.item_value ->> 'quantity')::integer as quantity
      from jsonb_array_elements(target_items) as item(item_value)
    )
    select 1
    from parsed_items
    group by product_id, variant_id
    having sum(quantity) > 10000
  ) then
    raise exception 'The quantity for one item cannot exceed 10,000.'
      using errcode = '23514';
  end if;

  insert into public.sales (
    organization_id,
    store_id,
    register_id,
    cashier_employee_id,
    currency_code,
    organization_name_snapshot,
    store_name_snapshot,
    register_name_snapshot,
    cashier_name_snapshot
  )
  values (
    target_organization_id,
    target_store_id,
    target_register_id,
    actor_employee_id,
    sale_currency_code,
    organization_name_snapshot,
    store_name_snapshot,
    register_name_snapshot,
    cashier_name_snapshot
  )
  returning id into new_sale_id;

  for checkout_line in
    with parsed_items as (
      select
        (item.item_value ->> 'product_id')::uuid as product_id,
        nullif(item.item_value ->> 'variant_id', '')::uuid as variant_id,
        (item.item_value ->> 'quantity')::integer as quantity
      from jsonb_array_elements(target_items) as item(item_value)
    )
    select product_id, variant_id, sum(quantity)::integer as quantity
    from parsed_items
    group by product_id, variant_id
    order by product_id, variant_id nulls first
  loop
    product_name_snapshot := null;
    variant_name_snapshot := null;
    sku_snapshot := null;
    unit_snapshot := null;
    resolved_price_minor := null;
    tracks_inventory := null;

    if checkout_line.variant_id is null then
      select
        product.name,
        null::text,
        product.sku,
        product.unit,
        product.price_minor,
        product.track_inventory
      into
        product_name_snapshot,
        variant_name_snapshot,
        sku_snapshot,
        unit_snapshot,
        resolved_price_minor,
        tracks_inventory
      from public.products product
      join public.product_store_settings setting
        on setting.organization_id = product.organization_id
       and setting.product_id = product.id
       and setting.store_id = target_store_id
       and setting.is_available
      where product.id = checkout_line.product_id
        and product.organization_id = target_organization_id
        and product.status = 'active'
        and product.product_type = 'simple'
      for share of product;
    else
      select
        product.name,
        variant.name,
        variant.sku,
        product.unit,
        variant.price_minor,
        product.track_inventory
      into
        product_name_snapshot,
        variant_name_snapshot,
        sku_snapshot,
        unit_snapshot,
        resolved_price_minor,
        tracks_inventory
      from public.products product
      join public.product_store_settings setting
        on setting.organization_id = product.organization_id
       and setting.product_id = product.id
       and setting.store_id = target_store_id
       and setting.is_available
      join public.product_variants variant
        on variant.id = checkout_line.variant_id
       and variant.product_id = product.id
       and variant.organization_id = product.organization_id
       and variant.is_active
      where product.id = checkout_line.product_id
        and product.organization_id = target_organization_id
        and product.status = 'active'
        and product.product_type = 'variable'
      for share of product, variant;
    end if;

    if resolved_price_minor is null then
      raise exception 'Every checkout item must be active and available at this store.'
        using errcode = '23514';
    end if;

    next_line_total_minor := resolved_price_minor * checkout_line.quantity;
    calculated_subtotal_minor := calculated_subtotal_minor + next_line_total_minor;

    insert into public.sale_items (
      organization_id,
      sale_id,
      product_id,
      variant_id,
      product_name_snapshot,
      variant_name_snapshot,
      sku_snapshot,
      unit_snapshot,
      quantity,
      unit_price_minor,
      line_total_minor
    )
    values (
      target_organization_id,
      new_sale_id,
      checkout_line.product_id,
      checkout_line.variant_id,
      product_name_snapshot,
      variant_name_snapshot,
      sku_snapshot,
      unit_snapshot,
      checkout_line.quantity,
      resolved_price_minor,
      next_line_total_minor
    );

    if tracks_inventory then
      select inventory_level.quantity
      into current_quantity
      from public.inventory_levels inventory_level
      where inventory_level.organization_id = target_organization_id
        and inventory_level.store_id = target_store_id
        and inventory_level.product_id = checkout_line.product_id
        and inventory_level.variant_id is not distinct from checkout_line.variant_id
      for update;

      if not found then
        raise exception 'The stock projection is not initialized for one checkout item.'
          using errcode = '23514';
      end if;

      next_quantity := current_quantity - checkout_line.quantity;

      update public.inventory_levels inventory_level
      set
        quantity = next_quantity,
        updated_at = now()
      where inventory_level.organization_id = target_organization_id
        and inventory_level.store_id = target_store_id
        and inventory_level.product_id = checkout_line.product_id
        and inventory_level.variant_id is not distinct from checkout_line.variant_id;

      insert into public.inventory_movements (
        organization_id,
        store_id,
        product_id,
        variant_id,
        quantity_delta,
        quantity_before,
        quantity_after,
        movement_type,
        actor_employee_id,
        reason,
        source_type,
        source_id
      )
      values (
        target_organization_id,
        target_store_id,
        checkout_line.product_id,
        checkout_line.variant_id,
        -checkout_line.quantity,
        current_quantity,
        next_quantity,
        'SALE',
        actor_employee_id,
        'Cash checkout',
        'sale',
        new_sale_id
      );
    end if;
  end loop;

  if target_cash_tendered_minor < calculated_subtotal_minor then
    raise exception 'Cash tender must cover the sale total.' using errcode = '23514';
  end if;

  update public.sales sale
  set
    subtotal_minor = calculated_subtotal_minor,
    total_minor = calculated_subtotal_minor
  where sale.id = new_sale_id
    and sale.organization_id = target_organization_id;

  insert into public.payments (
    organization_id,
    sale_id,
    payment_method,
    amount_minor,
    cash_tendered_minor,
    cash_change_minor
  )
  values (
    target_organization_id,
    new_sale_id,
    'cash',
    calculated_subtotal_minor,
    target_cash_tendered_minor,
    target_cash_tendered_minor - calculated_subtotal_minor
  );

  new_receipt_number := nextval('private.tindio_receipt_number_sequence'::regclass);

  insert into public.receipts (
    organization_id,
    sale_id,
    receipt_number
  )
  values (
    target_organization_id,
    new_sale_id,
    new_receipt_number
  );

  update public.checkout_requests request
  set
    state = 'completed',
    sale_id = new_sale_id,
    completed_at = now()
  where request.id = checkout_request_id;

  return query
  select
    new_sale_id,
    new_receipt_number,
    calculated_subtotal_minor,
    target_cash_tendered_minor,
    target_cash_tendered_minor - calculated_subtotal_minor,
    false;
end;
$$;

revoke execute on function private.checkout_cash_sale(
  uuid, uuid, uuid, bigint, uuid, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.checkout_cash_sale(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_cash_tendered_minor bigint,
  target_idempotency_key uuid,
  target_items jsonb
)
returns table (
  sale_id uuid,
  receipt_number bigint,
  total_minor bigint,
  cash_tendered_minor bigint,
  change_minor bigint,
  was_replayed boolean
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.checkout_cash_sale(
    target_organization_id,
    target_store_id,
    target_register_id,
    target_cash_tendered_minor,
    target_idempotency_key,
    target_items
  );
$$;

revoke execute on function public.checkout_cash_sale(
  uuid, uuid, uuid, bigint, uuid, jsonb
) from public, anon, service_role;

grant execute on function private.checkout_cash_sale(
  uuid, uuid, uuid, bigint, uuid, jsonb
) to authenticated;

grant execute on function public.checkout_cash_sale(
  uuid, uuid, uuid, bigint, uuid, jsonb
) to authenticated;

comment on function public.checkout_cash_sale(uuid, uuid, uuid, bigint, uuid, jsonb)
is 'Completes one cash sale atomically: server-derived prices and totals, sale, payment, receipt, and tracked inventory ledger deductions. Replaying the same organization idempotency key returns the original result.';

commit;
