begin;

-- Historical refunds always restored tracked stock. Preserve that completed
-- behavior for every existing row while recording the physical-return choice
-- for new refund lines.
alter table public.refund_items
  add column returned_to_stock boolean not null default true;

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
  selected_return_to_stock boolean;
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

  -- A missing return_to_stock flag retains the established behavior (restore
  -- tracked stock). When supplied, it must be a JSON boolean: strings such as
  -- "true", numeric values, and JSON null are rejected instead of coerced.
  if exists (
    select 1
    from jsonb_array_elements(target_items) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or (
        item.value ? 'return_to_stock'
        and jsonb_typeof(item.value -> 'return_to_stock') <> 'boolean'
      )
  ) then
    raise exception 'Each refund line must provide return_to_stock as a boolean when supplied.'
      using errcode = '23514';
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
      selected_return_to_stock := coalesce(
        (refund_item_value ->> 'return_to_stock')::boolean,
        true
      );
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
      line_total_minor,
      returned_to_stock
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
      original_item.unit_price_minor * selected_quantity,
      selected_return_to_stock
    );

    calculated_total_minor := calculated_total_minor
      + original_item.unit_price_minor * selected_quantity;

    if selected_return_to_stock and exists (
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
grant execute on function private.refund_sale(uuid, uuid, uuid, uuid, text, text, jsonb)
to authenticated;

comment on column public.refund_items.returned_to_stock
is 'Whether this refund line physically returned a tracked item to stock. Historical rows default to true.';
comment on function public.refund_sale(uuid, uuid, uuid, uuid, text, text, jsonb, uuid)
is 'Atomically records an authorized partial or full sale refund, restores tracked stock only for refund lines marked returned_to_stock (default true), and replays the same idempotency key safely.';

commit;
