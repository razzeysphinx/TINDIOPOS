-- TINDIO Phase 4: configurable payment methods and atomic split payments.
-- This migration preserves the original cash records, then evolves checkout into
-- one transaction that can record one or more store-enabled payment methods.

begin;

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null,
  code text not null,
  payment_type text not null,
  is_enabled boolean not null default true,
  requires_reference boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_methods_id_organization_unique unique (id, organization_id),
  constraint payment_methods_organization_code_unique unique (organization_id, code),
  constraint payment_methods_name_length check (char_length(name) between 1 and 100),
  constraint payment_methods_code_format check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  constraint payment_methods_type_values check (
    payment_type in ('CASH', 'CARD', 'E_WALLET', 'BANK_TRANSFER', 'VOUCHER', 'OTHER')
  ),
  constraint payment_methods_sort_order_bounds check (sort_order between 0 and 100000)
);

create index payment_methods_organization_enabled_sort_idx
  on public.payment_methods (organization_id, is_enabled, sort_order, name);

create unique index payment_methods_organization_name_unique_idx
  on public.payment_methods (organization_id, lower(name));

create table public.store_payment_methods (
  organization_id uuid not null,
  store_id uuid not null,
  payment_method_id uuid not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, payment_method_id),
  constraint store_payment_methods_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id)
    on delete restrict,
  constraint store_payment_methods_method_organization_fkey
    foreign key (payment_method_id, organization_id)
    references public.payment_methods (id, organization_id)
    on delete restrict
);

create index store_payment_methods_organization_store_enabled_idx
  on public.store_payment_methods (organization_id, store_id, is_enabled);

create index store_payment_methods_method_id_idx
  on public.store_payment_methods (payment_method_id);

create trigger payment_methods_set_updated_at
before update on public.payment_methods
for each row execute function private.set_updated_at();

create trigger store_payment_methods_set_updated_at
before update on public.store_payment_methods
for each row execute function private.set_updated_at();

create or replace function private.seed_default_payment_methods_for_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.payment_methods (
    organization_id,
    name,
    code,
    payment_type,
    requires_reference,
    sort_order
  )
  values
    (new.id, 'Cash', 'CASH', 'CASH', false, 10),
    (new.id, 'Card', 'CARD', 'CARD', false, 20),
    (new.id, 'GCash', 'GCASH', 'E_WALLET', false, 30),
    (new.id, 'Maya', 'MAYA', 'E_WALLET', false, 40),
    (new.id, 'Bank Transfer', 'BANK_TRANSFER', 'BANK_TRANSFER', false, 50)
  on conflict (organization_id, code) do nothing;

  return new;
end;
$$;

revoke execute on function private.seed_default_payment_methods_for_organization()
from public, anon, authenticated, service_role;

create trigger organizations_seed_default_payment_methods
after insert on public.organizations
for each row execute function private.seed_default_payment_methods_for_organization();

create or replace function private.seed_store_payment_method_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.store_payment_methods (
    organization_id,
    store_id,
    payment_method_id,
    is_enabled
  )
  select
    new.organization_id,
    new.id,
    payment_method.id,
    true
  from public.payment_methods payment_method
  where payment_method.organization_id = new.organization_id
  on conflict (store_id, payment_method_id) do nothing;

  return new;
end;
$$;

revoke execute on function private.seed_store_payment_method_availability()
from public, anon, authenticated, service_role;

create trigger stores_seed_payment_method_availability
after insert on public.stores
for each row execute function private.seed_store_payment_method_availability();

-- Bring organizations and stores created before this migration onto the same
-- defaults. Existing payment rows are backfilled below before the old cash-only
-- shape is removed.
insert into public.payment_methods (
  organization_id,
  name,
  code,
  payment_type,
  requires_reference,
  sort_order
)
select
  organization.id,
  defaults.name,
  defaults.code,
  defaults.payment_type,
  defaults.requires_reference,
  defaults.sort_order
from public.organizations organization
cross join (
  values
    ('Cash'::text, 'CASH'::text, 'CASH'::text, false, 10),
    ('Card', 'CARD', 'CARD', false, 20),
    ('GCash', 'GCASH', 'E_WALLET', false, 30),
    ('Maya', 'MAYA', 'E_WALLET', false, 40),
    ('Bank Transfer', 'BANK_TRANSFER', 'BANK_TRANSFER', false, 50)
) as defaults(name, code, payment_type, requires_reference, sort_order)
on conflict (organization_id, code) do nothing;

insert into public.store_payment_methods (
  organization_id,
  store_id,
  payment_method_id,
  is_enabled
)
select
  store.organization_id,
  store.id,
  payment_method.id,
  true
from public.stores store
join public.payment_methods payment_method
  on payment_method.organization_id = store.organization_id
on conflict (store_id, payment_method_id) do nothing;

alter table public.payments
  add column payment_method_id uuid,
  add column payment_method_name_snapshot text,
  add column payment_method_code_snapshot text,
  add column payment_method_type_snapshot text,
  add column reference_number text,
  add column note text;

update public.payments payment
set
  payment_method_id = payment_method.id,
  payment_method_name_snapshot = payment_method.name,
  payment_method_code_snapshot = payment_method.code,
  payment_method_type_snapshot = payment_method.payment_type
from public.payment_methods payment_method
where payment_method.organization_id = payment.organization_id
  and payment_method.code = 'CASH'
  and payment.payment_method = 'cash';

alter table public.payments
  drop constraint payments_method_values,
  drop constraint payments_amounts_nonnegative,
  drop constraint payments_cash_values_required,
  drop constraint payments_cash_math;

alter table public.payments
  rename column cash_tendered_minor to amount_tendered_minor;

alter table public.payments
  rename column cash_change_minor to change_given_minor;

alter table public.payments
  drop column payment_method,
  alter column payment_method_id set not null,
  alter column payment_method_name_snapshot set not null,
  alter column payment_method_code_snapshot set not null,
  alter column payment_method_type_snapshot set not null,
  add constraint payments_method_organization_fkey
    foreign key (payment_method_id, organization_id)
    references public.payment_methods (id, organization_id)
    on delete restrict,
  add constraint payments_amount_applied_positive check (amount_minor > 0),
  add constraint payments_tender_change_nonnegative check (
    (amount_tendered_minor is null or amount_tendered_minor >= 0)
    and (change_given_minor is null or change_given_minor >= 0)
  ),
  add constraint payments_method_name_snapshot_length check (
    char_length(payment_method_name_snapshot) between 1 and 100
  ),
  add constraint payments_method_code_snapshot_format check (
    payment_method_code_snapshot ~ '^[A-Z][A-Z0-9_]{1,39}$'
  ),
  add constraint payments_method_type_snapshot_values check (
    payment_method_type_snapshot in (
      'CASH', 'CARD', 'E_WALLET', 'BANK_TRANSFER', 'VOUCHER', 'OTHER'
    )
  ),
  add constraint payments_reference_number_length check (
    reference_number is null or char_length(reference_number) between 1 and 120
  ),
  add constraint payments_note_length check (
    note is null or char_length(note) between 1 and 500
  ),
  add constraint payments_cash_metadata_matches_type check (
    (
      payment_method_type_snapshot = 'CASH'
      and amount_tendered_minor is not null
      and change_given_minor is not null
      and amount_tendered_minor - change_given_minor = amount_minor
    )
    or (
      payment_method_type_snapshot <> 'CASH'
      and amount_tendered_minor is null
      and change_given_minor is null
    )
  );

create index payments_method_created_idx
  on public.payments (organization_id, payment_method_id, created_at desc);

alter table public.payment_methods enable row level security;
alter table public.store_payment_methods enable row level security;

revoke all on table public.payment_methods, public.store_payment_methods
from anon, authenticated;

grant select on public.payment_methods, public.store_payment_methods to authenticated;
grant insert on public.payment_methods to authenticated;
grant update (name, is_enabled, requires_reference, sort_order)
on public.payment_methods to authenticated;
grant insert on public.store_payment_methods to authenticated;
grant update (is_enabled) on public.store_payment_methods to authenticated;

create policy payment_methods_select_member
on public.payment_methods
for select
to authenticated
using ((select private.is_organization_member(organization_id)));

create policy payment_methods_insert_settings_manager
on public.payment_methods
for insert
to authenticated
with check ((select private.has_permission(organization_id, 'settings.manage')));

create policy payment_methods_update_settings_manager
on public.payment_methods
for update
to authenticated
using ((select private.has_permission(organization_id, 'settings.manage')))
with check ((select private.has_permission(organization_id, 'settings.manage')));

create policy store_payment_methods_select_assigned_or_manager
on public.store_payment_methods
for select
to authenticated
using (
  (select private.has_permission(organization_id, 'settings.manage'))
  or exists (
    select 1
    from public.employees employee
    join public.employee_stores employee_store
      on employee_store.employee_id = employee.id
     and employee_store.organization_id = employee.organization_id
    where employee.organization_id = store_payment_methods.organization_id
      and employee_store.store_id = store_payment_methods.store_id
      and employee.profile_id = (select auth.uid())
      and employee.status = 'active'
  )
);

create policy store_payment_methods_insert_settings_manager
on public.store_payment_methods
for insert
to authenticated
with check ((select private.has_permission(organization_id, 'settings.manage')));

create policy store_payment_methods_update_settings_manager
on public.store_payment_methods
for update
to authenticated
using ((select private.has_permission(organization_id, 'settings.manage')))
with check ((select private.has_permission(organization_id, 'settings.manage')));

create or replace function private.checkout_sale(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_idempotency_key uuid,
  target_items jsonb,
  target_payments jsonb
)
returns table (
  sale_id uuid,
  receipt_number bigint,
  total_minor bigint,
  change_minor bigint,
  payment_summary jsonb,
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
  existing_payment_summary jsonb;
  canonical_payload jsonb;
  checkout_line record;
  payment_input record;
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
  calculated_paid_minor bigint := 0;
  calculated_change_minor bigint := 0;
  remaining_minor bigint;
  requested_amount_minor bigint;
  tendered_minor bigint;
  applied_minor bigint;
  payment_change_minor bigint;
  selected_payment_method_id uuid;
  selected_payment_method_name text;
  selected_payment_method_code text;
  selected_payment_method_type text;
  selected_requires_reference boolean;
  selected_reference_number text;
  selected_note text;
  new_sale_id uuid;
  new_receipt_number bigint;
  new_payment_summary jsonb := '[]'::jsonb;
begin
  if target_organization_id is null
    or target_store_id is null
    or target_register_id is null
    or target_idempotency_key is null then
    raise exception 'A store, register, and checkout key are required.'
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

  if target_payments is null or jsonb_typeof(target_payments) <> 'array' then
    raise exception 'Checkout payments must be an array.' using errcode = '23514';
  end if;

  if jsonb_array_length(target_payments) not between 1 and 10 then
    raise exception 'A checkout must contain between 1 and 10 payments.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_payments) as payment(payment_value)
    where jsonb_typeof(payment.payment_value) <> 'object'
      or jsonb_typeof(payment.payment_value -> 'payment_method_id') <> 'string'
      or coalesce(payment.payment_value ->> 'payment_method_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (
        payment.payment_value ? 'amount_minor'
        and (
          jsonb_typeof(payment.payment_value -> 'amount_minor') <> 'number'
          or coalesce(payment.payment_value ->> 'amount_minor', '') !~ '^[0-9]{1,13}$'
        )
      )
      or (
        payment.payment_value ? 'amount_tendered_minor'
        and (
          jsonb_typeof(payment.payment_value -> 'amount_tendered_minor') <> 'number'
          or coalesce(payment.payment_value ->> 'amount_tendered_minor', '') !~ '^[0-9]{1,13}$'
        )
      )
      or (
        payment.payment_value ? 'reference_number'
        and jsonb_typeof(payment.payment_value -> 'reference_number') not in ('string', 'null')
      )
      or (
        payment.payment_value ? 'note'
        and jsonb_typeof(payment.payment_value -> 'note') not in ('string', 'null')
      )
      or char_length(coalesce(payment.payment_value ->> 'reference_number', '')) > 120
      or char_length(coalesce(payment.payment_value ->> 'note', '')) > 500
  ) then
    raise exception 'Each payment must include a valid payment method and supported amounts.'
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
    'items', target_items,
    'payments', target_payments,
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

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'payment_method_id', payment.payment_method_id,
          'name', payment.payment_method_name_snapshot,
          'code', payment.payment_method_code_snapshot,
          'type', payment.payment_method_type_snapshot,
          'amount_minor', payment.amount_minor,
          'amount_tendered_minor', payment.amount_tendered_minor,
          'change_given_minor', payment.change_given_minor,
          'reference_number', payment.reference_number,
          'note', payment.note
        ) order by payment.created_at, payment.id
      ),
      '[]'::jsonb
    )
    into existing_payment_summary
    from public.payments payment
    where payment.sale_id = existing_sale_id
      and payment.organization_id = target_organization_id;

    return query
    select
      completed_sale.id,
      receipt.receipt_number,
      completed_sale.total_minor,
      coalesce((
        select sum(payment.change_given_minor)
        from public.payments payment
        where payment.sale_id = completed_sale.id
          and payment.organization_id = completed_sale.organization_id
      ), 0::bigint),
      existing_payment_summary,
      true
    from public.sales completed_sale
    join public.receipts receipt
      on receipt.sale_id = completed_sale.id
     and receipt.organization_id = completed_sale.organization_id
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
        'POS checkout',
        'sale',
        new_sale_id
      );
    end if;
  end loop;

  if calculated_subtotal_minor <= 0 then
    raise exception 'A checkout total must be greater than zero.' using errcode = '23514';
  end if;

  update public.sales sale
  set
    subtotal_minor = calculated_subtotal_minor,
    total_minor = calculated_subtotal_minor
  where sale.id = new_sale_id
    and sale.organization_id = target_organization_id;

  for payment_input in
    select payment_value, ordinality
    from jsonb_array_elements(target_payments) with ordinality as payment(payment_value, ordinality)
    order by ordinality
  loop
    remaining_minor := calculated_subtotal_minor - calculated_paid_minor;

    if remaining_minor <= 0 then
      raise exception 'No additional payment is needed for this sale.' using errcode = '23514';
    end if;

    selected_payment_method_id := (payment_input.payment_value ->> 'payment_method_id')::uuid;
    selected_payment_method_name := null;
    selected_payment_method_code := null;
    selected_payment_method_type := null;
    selected_requires_reference := null;

    select
      payment_method.name,
      payment_method.code,
      payment_method.payment_type,
      payment_method.requires_reference
    into
      selected_payment_method_name,
      selected_payment_method_code,
      selected_payment_method_type,
      selected_requires_reference
    from public.payment_methods payment_method
    join public.store_payment_methods store_method
      on store_method.organization_id = payment_method.organization_id
     and store_method.payment_method_id = payment_method.id
     and store_method.store_id = target_store_id
     and store_method.is_enabled
    where payment_method.id = selected_payment_method_id
      and payment_method.organization_id = target_organization_id
      and payment_method.is_enabled
    for key share;

    if selected_payment_method_name is null then
      raise exception 'That payment method is not enabled for this store.'
        using errcode = '23514';
    end if;

    selected_reference_number := nullif(btrim(payment_input.payment_value ->> 'reference_number'), '');
    selected_note := nullif(btrim(payment_input.payment_value ->> 'note'), '');

    if selected_requires_reference and selected_reference_number is null then
      raise exception 'A reference number is required for the selected payment method.'
        using errcode = '23514';
    end if;

    if selected_payment_method_type = 'CASH' then
      if not (payment_input.payment_value ? 'amount_tendered_minor') then
        raise exception 'Cash tender is required.' using errcode = '23514';
      end if;

      tendered_minor := (payment_input.payment_value ->> 'amount_tendered_minor')::bigint;
      if tendered_minor <= 0 then
        raise exception 'Cash tender must be greater than zero.' using errcode = '23514';
      end if;

      applied_minor := least(tendered_minor, remaining_minor);
      payment_change_minor := tendered_minor - applied_minor;
    else
      if not (payment_input.payment_value ? 'amount_minor') then
        raise exception 'An amount is required for the selected payment method.'
          using errcode = '23514';
      end if;

      requested_amount_minor := (payment_input.payment_value ->> 'amount_minor')::bigint;
      if requested_amount_minor <= 0 or requested_amount_minor > remaining_minor then
        raise exception 'Payment amount must be greater than zero and no more than the remaining balance.'
          using errcode = '23514';
      end if;

      applied_minor := requested_amount_minor;
      tendered_minor := null;
      payment_change_minor := null;
    end if;

    insert into public.payments (
      organization_id,
      sale_id,
      payment_method_id,
      payment_method_name_snapshot,
      payment_method_code_snapshot,
      payment_method_type_snapshot,
      amount_minor,
      amount_tendered_minor,
      change_given_minor,
      reference_number,
      note
    )
    values (
      target_organization_id,
      new_sale_id,
      selected_payment_method_id,
      selected_payment_method_name,
      selected_payment_method_code,
      selected_payment_method_type,
      applied_minor,
      tendered_minor,
      payment_change_minor,
      selected_reference_number,
      selected_note
    );

    calculated_paid_minor := calculated_paid_minor + applied_minor;
    calculated_change_minor := calculated_change_minor + coalesce(payment_change_minor, 0);
    new_payment_summary := new_payment_summary || jsonb_build_array(
      jsonb_build_object(
        'payment_method_id', selected_payment_method_id,
        'name', selected_payment_method_name,
        'code', selected_payment_method_code,
        'type', selected_payment_method_type,
        'amount_minor', applied_minor,
        'amount_tendered_minor', tendered_minor,
        'change_given_minor', payment_change_minor,
        'reference_number', selected_reference_number,
        'note', selected_note
      )
    );
  end loop;

  if calculated_paid_minor <> calculated_subtotal_minor then
    raise exception 'Payments must exactly cover the sale total before completion.'
      using errcode = '23514';
  end if;

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
    calculated_change_minor,
    new_payment_summary,
    false;
end;
$$;

revoke execute on function private.checkout_sale(uuid, uuid, uuid, uuid, jsonb, jsonb)
from public, anon, authenticated, service_role;

create or replace function public.checkout_sale(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_idempotency_key uuid,
  target_items jsonb,
  target_payments jsonb
)
returns table (
  sale_id uuid,
  receipt_number bigint,
  total_minor bigint,
  change_minor bigint,
  payment_summary jsonb,
  was_replayed boolean
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.checkout_sale(
    target_organization_id,
    target_store_id,
    target_register_id,
    target_idempotency_key,
    target_items,
    target_payments
  );
$$;

revoke execute on function public.checkout_sale(uuid, uuid, uuid, uuid, jsonb, jsonb)
from public, anon, service_role;

grant execute on function private.checkout_sale(uuid, uuid, uuid, uuid, jsonb, jsonb)
to authenticated;

grant execute on function public.checkout_sale(uuid, uuid, uuid, uuid, jsonb, jsonb)
to authenticated;

-- Preserve the original RPC contract as a compatibility adapter. It delegates
-- all financial and inventory work to checkout_sale, so there is still exactly
-- one checkout implementation.
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
  cash_payment_method_id uuid;
begin
  if target_cash_tendered_minor is null
    or target_cash_tendered_minor < 0
    or target_cash_tendered_minor > 1000000000000 then
    raise exception 'Cash tender must be a non-negative supported amount.'
      using errcode = '23514';
  end if;

  select payment_method.id
  into cash_payment_method_id
  from public.payment_methods payment_method
  join public.store_payment_methods store_method
    on store_method.organization_id = payment_method.organization_id
   and store_method.payment_method_id = payment_method.id
   and store_method.store_id = target_store_id
   and store_method.is_enabled
  where payment_method.organization_id = target_organization_id
    and payment_method.payment_type = 'CASH'
    and payment_method.is_enabled
  order by payment_method.sort_order, payment_method.created_at
  limit 1;

  if cash_payment_method_id is null then
    raise exception 'Cash is not enabled for this store.' using errcode = '23514';
  end if;

  return query
  select
    checkout.sale_id,
    checkout.receipt_number,
    checkout.total_minor,
    target_cash_tendered_minor,
    checkout.change_minor,
    checkout.was_replayed
  from private.checkout_sale(
    target_organization_id,
    target_store_id,
    target_register_id,
    target_idempotency_key,
    target_items,
    jsonb_build_array(jsonb_build_object(
      'payment_method_id', cash_payment_method_id,
      'amount_tendered_minor', target_cash_tendered_minor
    ))
  ) checkout;
end;
$$;

revoke execute on function private.checkout_cash_sale(uuid, uuid, uuid, bigint, uuid, jsonb)
from public, anon, authenticated, service_role;

grant execute on function private.checkout_cash_sale(uuid, uuid, uuid, bigint, uuid, jsonb)
to authenticated;

comment on function public.checkout_sale(uuid, uuid, uuid, uuid, jsonb, jsonb)
is 'Completes one or more store-enabled payments atomically. Prices, totals, payment snapshots, receipt issuance, and tracked inventory movements are server-derived and idempotent.';

comment on function public.checkout_cash_sale(uuid, uuid, uuid, bigint, uuid, jsonb)
is 'Compatibility adapter for the original cash checkout RPC. It delegates to checkout_sale and does not duplicate transaction logic.';

commit;
