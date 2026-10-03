-- TINDIO Phase 5: receipt history, printing, and controlled refunds.
--
-- Refunds are separate immutable financial records. The original completed sale,
-- payment, receipt, and SALE stock movements are never altered or deleted.

begin;

create sequence private.tindio_refund_number_sequence
  as bigint
  start with 1
  increment by 1
  minvalue 1
  no maxvalue
  cache 1;

revoke all on sequence private.tindio_refund_number_sequence
from public, anon, authenticated, service_role;

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  sale_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  refunded_by_employee_id uuid not null,
  refund_number bigint not null,
  status text not null default 'completed',
  currency_code text not null,
  reason text not null,
  total_minor bigint not null default 0,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint refunds_id_organization_unique unique (id, organization_id),
  constraint refunds_sale_organization_fkey
    foreign key (sale_id, organization_id)
    references public.sales (id, organization_id)
    on delete restrict,
  constraint refunds_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id)
    on delete restrict,
  constraint refunds_register_organization_fkey
    foreign key (register_id, organization_id)
    references public.registers (id, organization_id)
    on delete restrict,
  constraint refunds_employee_organization_fkey
    foreign key (refunded_by_employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete restrict,
  constraint refunds_organization_number_unique unique (organization_id, refund_number),
  constraint refunds_status_values check (status = 'completed'),
  constraint refunds_currency_code_format check (currency_code ~ '^[A-Z]{3}$'),
  constraint refunds_reason_length check (char_length(reason) between 2 and 500),
  constraint refunds_total_nonnegative check (total_minor >= 0),
  constraint refunds_number_positive check (refund_number > 0)
);

create index refunds_organization_sale_completed_idx
  on public.refunds (organization_id, sale_id, completed_at desc);
create index refunds_refunded_by_completed_idx
  on public.refunds (refunded_by_employee_id, completed_at desc);

create table public.refund_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  refund_id uuid not null,
  sale_item_id uuid not null references public.sale_items (id) on delete restrict,
  product_id uuid not null,
  variant_id uuid,
  product_name_snapshot text not null,
  variant_name_snapshot text,
  sku_snapshot text,
  unit_snapshot text not null,
  quantity integer not null,
  unit_price_minor bigint not null,
  line_total_minor bigint not null,
  created_at timestamptz not null default now(),
  constraint refund_items_refund_organization_fkey
    foreign key (refund_id, organization_id)
    references public.refunds (id, organization_id)
    on delete restrict,
  constraint refund_items_product_organization_fkey
    foreign key (product_id, organization_id)
    references public.products (id, organization_id)
    on delete restrict,
  constraint refund_items_variant_product_organization_fkey
    foreign key (variant_id, product_id, organization_id)
    references public.product_variants (id, product_id, organization_id)
    on delete restrict,
  constraint refund_items_refund_sale_item_unique unique (refund_id, sale_item_id),
  constraint refund_items_product_name_snapshot_length check (
    char_length(product_name_snapshot) between 1 and 160
  ),
  constraint refund_items_variant_name_snapshot_length check (
    variant_name_snapshot is null or char_length(variant_name_snapshot) between 1 and 160
  ),
  constraint refund_items_sku_snapshot_length check (
    sku_snapshot is null or char_length(sku_snapshot) between 1 and 64
  ),
  constraint refund_items_unit_snapshot_length check (
    char_length(unit_snapshot) between 1 and 24
  ),
  constraint refund_items_quantity_bounds check (quantity between 1 and 10000),
  constraint refund_items_amounts_nonnegative check (
    unit_price_minor >= 0 and line_total_minor >= 0
  ),
  constraint refund_items_total_math check (
    line_total_minor = unit_price_minor * quantity
  )
);

create index refund_items_refund_id_idx on public.refund_items (refund_id);
create index refund_items_sale_item_id_idx on public.refund_items (sale_item_id);
create index refund_items_organization_product_idx
  on public.refund_items (organization_id, product_id);

create table public.refund_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  refund_id uuid not null,
  payment_method_id uuid not null,
  payment_method_name_snapshot text not null,
  payment_method_code_snapshot text not null,
  payment_method_type_snapshot text not null,
  amount_minor bigint not null,
  reference_number text,
  created_at timestamptz not null default now(),
  constraint refund_payments_refund_organization_fkey
    foreign key (refund_id, organization_id)
    references public.refunds (id, organization_id)
    on delete restrict,
  constraint refund_payments_method_organization_fkey
    foreign key (payment_method_id, organization_id)
    references public.payment_methods (id, organization_id)
    on delete restrict,
  constraint refund_payments_one_per_refund_unique unique (refund_id),
  constraint refund_payments_amount_positive check (amount_minor > 0),
  constraint refund_payments_method_name_snapshot_length check (
    char_length(payment_method_name_snapshot) between 1 and 100
  ),
  constraint refund_payments_method_code_snapshot_format check (
    payment_method_code_snapshot ~ '^[A-Z][A-Z0-9_]{1,39}$'
  ),
  constraint refund_payments_method_type_snapshot_values check (
    payment_method_type_snapshot in (
      'CASH', 'CARD', 'E_WALLET', 'BANK_TRANSFER', 'VOUCHER', 'OTHER'
    )
  ),
  constraint refund_payments_reference_number_length check (
    reference_number is null or char_length(reference_number) between 1 and 120
  )
);

create index refund_payments_organization_method_created_idx
  on public.refund_payments (organization_id, payment_method_id, created_at desc);

create table public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  actor_employee_id uuid not null,
  idempotency_key uuid not null,
  request_payload jsonb not null,
  state text not null default 'processing',
  refund_id uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint refund_requests_actor_organization_fkey
    foreign key (actor_employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete restrict,
  constraint refund_requests_refund_organization_fkey
    foreign key (refund_id, organization_id)
    references public.refunds (id, organization_id)
    on delete restrict,
  constraint refund_requests_organization_key_unique
    unique (organization_id, idempotency_key),
  constraint refund_requests_payload_object check (jsonb_typeof(request_payload) = 'object'),
  constraint refund_requests_state_values check (state in ('processing', 'completed')),
  constraint refund_requests_completion_state check (
    (state = 'processing' and refund_id is null and completed_at is null)
    or (state = 'completed' and refund_id is not null and completed_at is not null)
  )
);

create index refund_requests_actor_created_idx
  on public.refund_requests (actor_employee_id, created_at desc);
create unique index refund_requests_refund_unique_idx
  on public.refund_requests (refund_id)
  where refund_id is not null;

alter table public.inventory_movements
  drop constraint inventory_movements_type_values;

alter table public.inventory_movements
  add constraint inventory_movements_type_values check (
    movement_type in ('OPENING_STOCK', 'ADJUSTMENT', 'SALE', 'REFUND')
  );

alter table public.refunds enable row level security;
alter table public.refund_items enable row level security;
alter table public.refund_payments enable row level security;
alter table public.refund_requests enable row level security;

revoke all on table public.refunds, public.refund_items, public.refund_payments,
  public.refund_requests
from public, anon, authenticated, service_role;

grant select on table public.refunds, public.refund_items, public.refund_payments
to authenticated;

create policy refunds_select_receipts_authorized
on public.refunds
for select
to authenticated
using ((select private.has_permission(organization_id, 'receipts.view')));

create policy refund_items_select_receipts_authorized
on public.refund_items
for select
to authenticated
using ((select private.has_permission(organization_id, 'receipts.view')));

create policy refund_payments_select_receipts_authorized
on public.refund_payments
for select
to authenticated
using ((select private.has_permission(organization_id, 'receipts.view')));

create or replace function private.refund_sale(
  target_organization_id uuid,
  target_sale_id uuid,
  target_payment_method_id uuid,
  target_idempotency_key uuid,
  target_reason text,
  target_reference_number text,
  target_items jsonb
)
returns table (
  refund_id uuid,
  refund_number bigint,
  total_minor bigint,
  was_replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  existing_actor_employee_id uuid;
  existing_payload jsonb;
  existing_refund_id uuid;
  original_sale public.sales%rowtype;
  original_item public.sale_items%rowtype;
  refund_item_value jsonb;
  selected_sale_item_id uuid;
  selected_quantity integer;
  already_refunded_quantity integer;
  calculated_total_minor bigint := 0;
  new_refund_id uuid;
  new_refund_number bigint;
  current_quantity numeric(14, 3);
  next_quantity numeric(14, 3);
  payment_method_record public.payment_methods%rowtype;
  canonical_payload jsonb;
  normalized_reason text;
  normalized_reference_number text;
  seen_sale_item_ids uuid[] := array[]::uuid[];
begin
  if target_organization_id is null
    or target_sale_id is null
    or target_idempotency_key is null then
    raise exception 'A sale and refund key are required.' using errcode = '23514';
  end if;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'sales.refund')) then
    raise exception 'Sales refund permission is required.' using errcode = '42501';
  end if;

  normalized_reason := trim(coalesce(target_reason, ''));
  normalized_reference_number := nullif(trim(coalesce(target_reference_number, '')), '');

  if char_length(normalized_reason) not between 2 and 500 then
    raise exception 'A refund reason must contain between 2 and 500 characters.'
      using errcode = '23514';
  end if;

  if normalized_reference_number is not null
    and char_length(normalized_reference_number) not between 1 and 120 then
    raise exception 'A refund reference must contain at most 120 characters.'
      using errcode = '23514';
  end if;

  if coalesce(jsonb_typeof(target_items), '') <> 'array'
    or coalesce(jsonb_array_length(target_items), 0) not between 1 and 100 then
    raise exception 'Select between 1 and 100 sale items to refund.' using errcode = '23514';
  end if;

  select sale.*
  into original_sale
  from public.sales sale
  where sale.id = target_sale_id
    and sale.organization_id = target_organization_id
    and sale.status = 'completed'
  for update;

  if original_sale.id is null then
    raise exception 'The completed sale was not found.' using errcode = 'P0002';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  join public.employee_stores employee_store
    on employee_store.employee_id = employee.id
   and employee_store.organization_id = employee.organization_id
   and employee_store.store_id = original_sale.store_id
  join public.stores store
    on store.id = original_sale.store_id
   and store.organization_id = original_sale.organization_id
   and store.is_active
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active';

  if actor_employee_id is null then
    raise exception 'An active employee assignment for the original sale store is required.'
      using errcode = '42501';
  end if;

  canonical_payload := jsonb_build_object(
    'items', target_items,
    'payment_method_id', target_payment_method_id,
    'reason', normalized_reason,
    'reference_number', normalized_reference_number,
    'sale_id', target_sale_id
  );

  select
    request.actor_employee_id,
    request.request_payload,
    request.refund_id
  into
    existing_actor_employee_id,
    existing_payload,
    existing_refund_id
  from public.refund_requests request
  where request.organization_id = target_organization_id
    and request.idempotency_key = target_idempotency_key
  for update;

  if found then
    if existing_actor_employee_id is distinct from actor_employee_id
      or existing_payload is distinct from canonical_payload then
      raise exception 'This refund key was already used for a different request.'
        using errcode = '23505';
    end if;

    if existing_refund_id is null then
      raise exception 'The prior refund request did not complete. Try again with a new key.'
        using errcode = '40001';
    end if;

    return query
    select refund.id, refund.refund_number, refund.total_minor, true
    from public.refunds refund
    where refund.id = existing_refund_id
      and refund.organization_id = target_organization_id;
    return;
  end if;

  -- Lock stock projections in a stable order before the line loop. This keeps
  -- independent refunds from acquiring inventory locks in conflicting orders.
  perform 1
  from public.inventory_levels level
  join public.sale_items sale_item
    on sale_item.organization_id = level.organization_id
   and sale_item.product_id = level.product_id
   and sale_item.variant_id is not distinct from level.variant_id
  where level.organization_id = target_organization_id
    and level.store_id = original_sale.store_id
    and sale_item.sale_id = target_sale_id
    and sale_item.id in (
      select (item.value ->> 'sale_item_id')::uuid
      from jsonb_array_elements(target_items) as item(value)
    )
    and exists (
      select 1
      from public.inventory_movements movement
      where movement.organization_id = target_organization_id
        and movement.store_id = original_sale.store_id
        and movement.product_id = sale_item.product_id
        and movement.variant_id is not distinct from sale_item.variant_id
        and movement.movement_type = 'SALE'
        and movement.source_type = 'sale'
        and movement.source_id = target_sale_id
    )
  order by level.product_id, level.variant_id nulls first
  for update;

  insert into public.refund_requests (
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
  );

  new_refund_number := nextval('private.tindio_refund_number_sequence'::regclass);

  insert into public.refunds (
    organization_id,
    sale_id,
    store_id,
    register_id,
    refunded_by_employee_id,
    refund_number,
    currency_code,
    reason
  )
  values (
    target_organization_id,
    target_sale_id,
    original_sale.store_id,
    original_sale.register_id,
    actor_employee_id,
    new_refund_number,
    original_sale.currency_code,
    normalized_reason
  )
  returning id into new_refund_id;

  for refund_item_value in
    select item.value
    from jsonb_array_elements(target_items) as item(value)
    order by item.value ->> 'sale_item_id'
  loop
    begin
      selected_sale_item_id := (refund_item_value ->> 'sale_item_id')::uuid;
      selected_quantity := (refund_item_value ->> 'quantity')::integer;
    exception
      when others then
        raise exception 'Each refund line needs a valid sale item and whole quantity.'
          using errcode = '23514';
    end;

    if selected_quantity not between 1 and 10000 then
      raise exception 'Refund quantities must be whole numbers between 1 and 10000.'
        using errcode = '23514';
    end if;

    if selected_sale_item_id = any(seen_sale_item_ids) then
      raise exception 'Each sale item can only appear once in a refund.'
        using errcode = '23514';
    end if;
    seen_sale_item_ids := array_append(seen_sale_item_ids, selected_sale_item_id);

    select sale_item.*
    into original_item
    from public.sale_items sale_item
    where sale_item.id = selected_sale_item_id
      and sale_item.organization_id = target_organization_id
      and sale_item.sale_id = target_sale_id
    for update;

    if original_item.id is null then
      raise exception 'One or more selected items do not belong to this sale.'
        using errcode = '23514';
    end if;

    select coalesce(sum(refund_item.quantity), 0)::integer
    into already_refunded_quantity
    from public.refund_items refund_item
    join public.refunds prior_refund
      on prior_refund.id = refund_item.refund_id
     and prior_refund.organization_id = refund_item.organization_id
    where refund_item.organization_id = target_organization_id
      and refund_item.sale_item_id = original_item.id
      and prior_refund.sale_id = target_sale_id
      and prior_refund.status = 'completed';

    if already_refunded_quantity + selected_quantity > original_item.quantity then
      raise exception 'This refund exceeds the quantity remaining on the original sale.'
        using errcode = '23514';
    end if;

    insert into public.refund_items (
      organization_id,
      refund_id,
      sale_item_id,
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
      new_refund_id,
      original_item.id,
      original_item.product_id,
      original_item.variant_id,
      original_item.product_name_snapshot,
      original_item.variant_name_snapshot,
      original_item.sku_snapshot,
      original_item.unit_snapshot,
      selected_quantity,
      original_item.unit_price_minor,
      original_item.unit_price_minor * selected_quantity
    );

    calculated_total_minor := calculated_total_minor
      + original_item.unit_price_minor * selected_quantity;

    if exists (
      select 1
      from public.inventory_movements movement
      where movement.organization_id = target_organization_id
        and movement.store_id = original_sale.store_id
        and movement.product_id = original_item.product_id
        and movement.variant_id is not distinct from original_item.variant_id
        and movement.movement_type = 'SALE'
        and movement.source_type = 'sale'
        and movement.source_id = target_sale_id
    ) then
      select level.quantity
      into current_quantity
      from public.inventory_levels level
      where level.organization_id = target_organization_id
        and level.store_id = original_sale.store_id
        and level.product_id = original_item.product_id
        and level.variant_id is not distinct from original_item.variant_id;

      if current_quantity is null then
        raise exception 'The stock projection is unavailable for a tracked sale item.'
          using errcode = '23514';
      end if;

      next_quantity := current_quantity + selected_quantity;

      update public.inventory_levels
      set
        quantity = next_quantity,
        updated_at = now()
      where organization_id = target_organization_id
        and store_id = original_sale.store_id
        and product_id = original_item.product_id
        and variant_id is not distinct from original_item.variant_id;

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
        original_sale.store_id,
        original_item.product_id,
        original_item.variant_id,
        selected_quantity,
        current_quantity,
        next_quantity,
        'REFUND',
        actor_employee_id,
        normalized_reason,
        'refund',
        new_refund_id
      );
    end if;
  end loop;

  if calculated_total_minor > 0 then
    if target_payment_method_id is null then
      raise exception 'Select the method used to return the payment.' using errcode = '23514';
    end if;

    select payment_method.*
    into payment_method_record
    from public.payment_methods payment_method
    join public.store_payment_methods store_payment_method
      on store_payment_method.organization_id = payment_method.organization_id
     and store_payment_method.payment_method_id = payment_method.id
     and store_payment_method.store_id = original_sale.store_id
     and store_payment_method.is_enabled
    where payment_method.organization_id = target_organization_id
      and payment_method.id = target_payment_method_id
      and payment_method.is_enabled;

    if payment_method_record.id is null then
      raise exception 'Select an enabled payment method for the original sale store.'
        using errcode = '23514';
    end if;

    if payment_method_record.requires_reference and normalized_reference_number is null then
      raise exception 'A reference is required for this refund payment method.'
        using errcode = '23514';
    end if;

    insert into public.refund_payments (
      organization_id,
      refund_id,
      payment_method_id,
      payment_method_name_snapshot,
      payment_method_code_snapshot,
      payment_method_type_snapshot,
      amount_minor,
      reference_number
    )
    values (
      target_organization_id,
      new_refund_id,
      payment_method_record.id,
      payment_method_record.name,
      payment_method_record.code,
      payment_method_record.payment_type,
      calculated_total_minor,
      normalized_reference_number
    );
  end if;

  update public.refunds refund
  set total_minor = calculated_total_minor
  where refund.id = new_refund_id
    and refund.organization_id = target_organization_id;

  update public.refund_requests request
  set
    state = 'completed',
    refund_id = new_refund_id,
    completed_at = now()
  where request.organization_id = target_organization_id
    and request.idempotency_key = target_idempotency_key;

  return query
  select new_refund_id, new_refund_number, calculated_total_minor, false;
end;
$$;

revoke execute on function private.refund_sale(uuid, uuid, uuid, uuid, text, text, jsonb)
from public, anon, authenticated, service_role;

create or replace function public.refund_sale(
  target_organization_id uuid,
  target_sale_id uuid,
  target_payment_method_id uuid,
  target_idempotency_key uuid,
  target_reason text,
  target_reference_number text,
  target_items jsonb
)
returns table (
  refund_id uuid,
  refund_number bigint,
  total_minor bigint,
  was_replayed boolean
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.refund_sale(
    target_organization_id,
    target_sale_id,
    target_payment_method_id,
    target_idempotency_key,
    target_reason,
    target_reference_number,
    target_items
  );
$$;

revoke execute on function public.refund_sale(uuid, uuid, uuid, uuid, text, text, jsonb)
from public, anon, service_role;

grant execute on function private.refund_sale(uuid, uuid, uuid, uuid, text, text, jsonb)
to authenticated;

grant execute on function public.refund_sale(uuid, uuid, uuid, uuid, text, text, jsonb)
to authenticated;

comment on table public.refunds
is 'Immutable completed refund headers. Original completed sales remain unchanged.';
comment on table public.refund_items
is 'Immutable refund-line snapshots linked to the original sale items.';
comment on table public.refund_payments
is 'Immutable method snapshot for a monetary refund; zero-value inventory-only refunds have no payment row.';
comment on table public.refund_requests
is 'Private idempotency records for refund processing.';
comment on function public.refund_sale(uuid, uuid, uuid, uuid, text, text, jsonb)
is 'Atomically records an authorized partial or full sale refund, restores originally tracked stock, and replays the same idempotency key safely.';

commit;
