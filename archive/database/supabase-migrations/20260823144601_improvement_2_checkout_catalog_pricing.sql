-- Checkout pricing is always resolved on the database. The POS may request a
-- manual price only for a product explicitly configured for that purpose.

begin;

alter table public.sale_items
  alter column quantity type numeric(14, 3)
  using quantity::numeric(14, 3);

alter table public.sale_items
  drop constraint sale_items_quantity_bounds,
  add constraint sale_items_quantity_bounds check (
    quantity >= 0.001 and quantity <= 10000
  );

alter table public.sale_items
  drop constraint sale_items_total_math,
  add constraint sale_items_total_math check (
    line_total_minor = round(
      unit_price_minor::numeric * quantity - discount_minor::numeric + tax_minor::numeric
    )::bigint
  );

create or replace function private.quote_checkout_subtotal(
  target_organization_id uuid,
  target_store_id uuid,
  target_items jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  checkout_line record;
  product_price_minor bigint;
  requested_price_minor bigint;
  quantity numeric(14, 3);
  product_allows_fractional boolean;
  product_is_variable_price boolean;
  calculated_subtotal_minor bigint := 0;
begin
  if target_items is null or jsonb_typeof(target_items) <> 'array'
    or jsonb_array_length(target_items) not between 1 and 100 then
    raise exception 'Checkout items must contain between 1 and 100 items.' using errcode = '23514';
  end if;

  for checkout_line in
    select value, ordinality
    from jsonb_array_elements(target_items) with ordinality
  loop
    if jsonb_typeof(checkout_line.value) <> 'object'
      or jsonb_typeof(checkout_line.value -> 'product_id') <> 'string'
      or coalesce(checkout_line.value ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(checkout_line.value ->> 'quantity', '') !~ '^(?:0|[1-9][0-9]{0,3})([.][0-9]{1,3})?$' then
      raise exception 'Each checkout item must have valid item references and quantity.' using errcode = '23514';
    end if;

    quantity := (checkout_line.value ->> 'quantity')::numeric(14, 3);
    if quantity <= 0 then
      raise exception 'Each checkout item must have a quantity greater than zero.' using errcode = '23514';
    end if;
    if nullif(checkout_line.value ->> 'variant_id', '') is null then
      select
        coalesce(setting.price_override_minor, product.price_minor),
        product.allow_fractional_quantity,
        product.is_variable_price
      into product_price_minor, product_allows_fractional, product_is_variable_price
      from public.products product
      join public.product_store_settings setting
        on setting.organization_id = product.organization_id
       and setting.product_id = product.id
       and setting.store_id = target_store_id
       and setting.is_available
      where product.id = (checkout_line.value ->> 'product_id')::uuid
        and product.organization_id = target_organization_id
        and product.status = 'active'
        and product.product_type = 'simple';
    else
      if jsonb_typeof(checkout_line.value -> 'variant_id') <> 'string'
        or checkout_line.value ->> 'variant_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'Each checkout item must have valid item references and quantity.' using errcode = '23514';
      end if;
      select
        variant.price_minor,
        product.allow_fractional_quantity,
        false
      into product_price_minor, product_allows_fractional, product_is_variable_price
      from public.products product
      join public.product_store_settings setting
        on setting.organization_id = product.organization_id
       and setting.product_id = product.id
       and setting.store_id = target_store_id
       and setting.is_available
      join public.product_variants variant
        on variant.id = (checkout_line.value ->> 'variant_id')::uuid
       and variant.product_id = product.id
       and variant.organization_id = product.organization_id
       and variant.is_active
      where product.id = (checkout_line.value ->> 'product_id')::uuid
        and product.organization_id = target_organization_id
        and product.status = 'active'
        and product.product_type = 'variable';
    end if;

    if product_price_minor is null then
      raise exception 'Every checkout item must be active and available at this store.' using errcode = '23514';
    end if;
    if quantity <> trunc(quantity) and not product_allows_fractional then
      raise exception 'This product must be sold in whole units.' using errcode = '23514';
    end if;
    if product_is_variable_price then
      if jsonb_typeof(checkout_line.value -> 'unit_price_minor') <> 'number'
        or coalesce(checkout_line.value ->> 'unit_price_minor', '') !~ '^[1-9][0-9]{0,9}$' then
        raise exception 'Enter a supported manual price for this product.' using errcode = '23514';
      end if;
      requested_price_minor := (checkout_line.value ->> 'unit_price_minor')::bigint;
      product_price_minor := requested_price_minor;
    elsif checkout_line.value ? 'unit_price_minor'
      and checkout_line.value -> 'unit_price_minor' <> 'null'::jsonb then
      raise exception 'Manual pricing is not enabled for this product.' using errcode = '23514';
    end if;

    calculated_subtotal_minor := calculated_subtotal_minor
      + round(product_price_minor::numeric * quantity)::bigint;
  end loop;

  if calculated_subtotal_minor <= 0 then
    raise exception 'A checkout total must be greater than zero.' using errcode = '23514';
  end if;

  return calculated_subtotal_minor;
end;
$$;

create or replace function private.checkout_catalog_special_sale(
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
  checkout_line record;
  quantity numeric(14, 3);
  resolved_price_minor bigint;
  requested_price_minor bigint;
  line_total_minor bigint;
  product_name_snapshot text;
  variant_name_snapshot text;
  sku_snapshot text;
  unit_snapshot text;
  tracks_inventory boolean;
  product_allows_fractional boolean;
  product_is_variable_price boolean;
  current_quantity numeric(14, 3);
  next_quantity numeric(14, 3);
  calculated_subtotal_minor bigint := 0;
  new_sale_id uuid;
  new_receipt_number bigint;
  payment_row jsonb;
  selected_payment_method_id uuid;
  payment_name text;
  payment_code text;
  payment_type text;
  payment_requires_reference boolean;
  tendered_minor bigint;
  applied_minor bigint;
  change_given_minor bigint;
  payment_reference text;
  payment_note text;
  canonical_payload jsonb;
begin
  if target_items is null or jsonb_typeof(target_items) <> 'array'
    or jsonb_array_length(target_items) not between 1 and 100
    or target_payments is null or jsonb_typeof(target_payments) <> 'array'
    or jsonb_array_length(target_payments) <> 1 then
    raise exception 'Special catalogue checkout requires valid items and one internal payment.' using errcode = '23514';
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
  join public.organizations organization on organization.id = employee.organization_id
  join public.stores store
    on store.id = target_store_id
   and store.organization_id = employee.organization_id
   and store.is_active
  join public.registers register
    on register.id = target_register_id
   and register.store_id = store.id
   and register.organization_id = store.organization_id
   and register.is_active
  join public.profiles profile on profile.id = employee.profile_id
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active';

  if actor_employee_id is null then
    raise exception 'An active assigned employee and register are required.' using errcode = '42501';
  end if;

  canonical_payload := jsonb_build_object(
    'items', target_items,
    'payments', target_payments,
    'register_id', target_register_id,
    'store_id', target_store_id
  );
  insert into public.checkout_requests (
    organization_id, actor_employee_id, idempotency_key, request_payload
  ) values (
    target_organization_id, actor_employee_id, target_idempotency_key, canonical_payload
  ) on conflict (organization_id, idempotency_key) do nothing
  returning id into checkout_request_id;
  if checkout_request_id is null then
    raise exception 'The prior checkout request did not complete. Try again with a new checkout key.' using errcode = '40001';
  end if;

  insert into public.sales (
    organization_id, store_id, register_id, cashier_employee_id, currency_code,
    organization_name_snapshot, store_name_snapshot, register_name_snapshot, cashier_name_snapshot
  ) values (
    target_organization_id, target_store_id, target_register_id, actor_employee_id, sale_currency_code,
    organization_name_snapshot, store_name_snapshot, register_name_snapshot, cashier_name_snapshot
  ) returning id into new_sale_id;

  for checkout_line in
    select value
    from jsonb_array_elements(target_items)
  loop
    if jsonb_typeof(checkout_line.value) <> 'object'
      or jsonb_typeof(checkout_line.value -> 'product_id') <> 'string'
      or coalesce(checkout_line.value ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(checkout_line.value ->> 'quantity', '') !~ '^(?:0|[1-9][0-9]{0,3})([.][0-9]{1,3})?$' then
      raise exception 'Each checkout item must have valid item references and quantity.' using errcode = '23514';
    end if;
    quantity := (checkout_line.value ->> 'quantity')::numeric(14, 3);
    if quantity <= 0 then
      raise exception 'Each checkout item must have a quantity greater than zero.' using errcode = '23514';
    end if;
    product_name_snapshot := null;
    variant_name_snapshot := null;
    sku_snapshot := null;
    unit_snapshot := null;
    resolved_price_minor := null;
    tracks_inventory := null;

    if nullif(checkout_line.value ->> 'variant_id', '') is null then
      select
        product.name,
        null::text,
        product.sku,
        product.unit,
        coalesce(setting.price_override_minor, product.price_minor),
        product.track_inventory,
        product.allow_fractional_quantity,
        product.is_variable_price
      into
        product_name_snapshot,
        variant_name_snapshot,
        sku_snapshot,
        unit_snapshot,
        resolved_price_minor,
        tracks_inventory,
        product_allows_fractional,
        product_is_variable_price
      from public.products product
      join public.product_store_settings setting
        on setting.organization_id = product.organization_id
       and setting.product_id = product.id
       and setting.store_id = target_store_id
       and setting.is_available
      where product.id = (checkout_line.value ->> 'product_id')::uuid
        and product.organization_id = target_organization_id
        and product.status = 'active'
        and product.product_type = 'simple'
      for share of product;
    else
      if jsonb_typeof(checkout_line.value -> 'variant_id') <> 'string'
        or checkout_line.value ->> 'variant_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'Each checkout item must have valid item references and quantity.' using errcode = '23514';
      end if;
      select
        product.name,
        variant.name,
        variant.sku,
        product.unit,
        variant.price_minor,
        product.track_inventory,
        product.allow_fractional_quantity,
        false
      into
        product_name_snapshot,
        variant_name_snapshot,
        sku_snapshot,
        unit_snapshot,
        resolved_price_minor,
        tracks_inventory,
        product_allows_fractional,
        product_is_variable_price
      from public.products product
      join public.product_store_settings setting
        on setting.organization_id = product.organization_id
       and setting.product_id = product.id
       and setting.store_id = target_store_id
       and setting.is_available
      join public.product_variants variant
        on variant.id = (checkout_line.value ->> 'variant_id')::uuid
       and variant.product_id = product.id
       and variant.organization_id = product.organization_id
       and variant.is_active
      where product.id = (checkout_line.value ->> 'product_id')::uuid
        and product.organization_id = target_organization_id
        and product.status = 'active'
        and product.product_type = 'variable'
      for share of product, variant;
    end if;

    if resolved_price_minor is null then
      raise exception 'Every checkout item must be active and available at this store.' using errcode = '23514';
    end if;
    if quantity <> trunc(quantity) and not product_allows_fractional then
      raise exception 'This product must be sold in whole units.' using errcode = '23514';
    end if;
    if product_is_variable_price then
      if jsonb_typeof(checkout_line.value -> 'unit_price_minor') <> 'number'
        or coalesce(checkout_line.value ->> 'unit_price_minor', '') !~ '^[1-9][0-9]{0,9}$' then
        raise exception 'Enter a supported manual price for this product.' using errcode = '23514';
      end if;
      requested_price_minor := (checkout_line.value ->> 'unit_price_minor')::bigint;
      resolved_price_minor := requested_price_minor;
    elsif checkout_line.value ? 'unit_price_minor'
      and checkout_line.value -> 'unit_price_minor' <> 'null'::jsonb then
      raise exception 'Manual pricing is not enabled for this product.' using errcode = '23514';
    end if;

    line_total_minor := round(resolved_price_minor::numeric * quantity)::bigint;
    calculated_subtotal_minor := calculated_subtotal_minor + line_total_minor;

    insert into public.sale_items (
      organization_id, sale_id, product_id, variant_id, product_name_snapshot,
      variant_name_snapshot, sku_snapshot, unit_snapshot, quantity,
      unit_price_minor, modifier_total_minor, modifiers_snapshot, line_total_minor
    ) values (
      target_organization_id, new_sale_id, (checkout_line.value ->> 'product_id')::uuid,
      nullif(checkout_line.value ->> 'variant_id', '')::uuid, product_name_snapshot,
      variant_name_snapshot, sku_snapshot, unit_snapshot, quantity,
      resolved_price_minor, 0, '[]'::jsonb, line_total_minor
    );
  end loop;

  if calculated_subtotal_minor <= 0 then
    raise exception 'A checkout total must be greater than zero.' using errcode = '23514';
  end if;

  update public.sales
  set subtotal_minor = calculated_subtotal_minor,
      total_minor = calculated_subtotal_minor
  where id = new_sale_id and organization_id = target_organization_id;

  -- Lock and ledger tracked stock only after the sale has a stable source ID.
  for checkout_line in
    select item.id, item.product_id, item.variant_id, item.quantity
    from public.sale_items item
    where item.organization_id = target_organization_id and item.sale_id = new_sale_id
    order by item.product_id, item.variant_id nulls first
  loop
    select inventory_level.quantity into current_quantity
    from public.inventory_levels inventory_level
    where inventory_level.organization_id = target_organization_id
      and inventory_level.store_id = target_store_id
      and inventory_level.product_id = checkout_line.product_id
      and inventory_level.variant_id is not distinct from checkout_line.variant_id
    for update;

    if exists (
      select 1 from public.products product
      where product.id = checkout_line.product_id and product.organization_id = target_organization_id
        and product.track_inventory
    ) then
      if current_quantity is null then
        raise exception 'The stock projection is not initialized for one checkout item.' using errcode = '23514';
      end if;
      next_quantity := current_quantity - checkout_line.quantity;
      update public.inventory_levels inventory_level
      set quantity = next_quantity, updated_at = now()
      where inventory_level.organization_id = target_organization_id
        and inventory_level.store_id = target_store_id
        and inventory_level.product_id = checkout_line.product_id
        and inventory_level.variant_id is not distinct from checkout_line.variant_id;
      insert into public.inventory_movements (
        organization_id, store_id, product_id, variant_id, quantity_delta,
        quantity_before, quantity_after, movement_type, actor_employee_id, reason, source_type, source_id
      ) values (
        target_organization_id, target_store_id, checkout_line.product_id, checkout_line.variant_id,
        -checkout_line.quantity, current_quantity, next_quantity, 'SALE', actor_employee_id,
        'Catalog checkout', 'sale', new_sale_id
      );
    end if;
  end loop;

  payment_row := target_payments -> 0;
  if jsonb_typeof(payment_row -> 'payment_method_id') <> 'string'
    or coalesce(payment_row ->> 'payment_method_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'Each payment must include a valid payment method.' using errcode = '23514';
  end if;
  selected_payment_method_id := (payment_row ->> 'payment_method_id')::uuid;
  select method.name, method.code, method.payment_type, method.requires_reference
  into payment_name, payment_code, payment_type, payment_requires_reference
  from public.payment_methods method
  join public.store_payment_methods store_method
    on store_method.organization_id = method.organization_id
   and store_method.payment_method_id = method.id
   and store_method.store_id = target_store_id
   and store_method.is_enabled
  where method.id = selected_payment_method_id
    and method.organization_id = target_organization_id
    and method.is_enabled
    and not method.is_loyalty_redemption;
  if payment_name is null then
    raise exception 'That payment method is not enabled for this store.' using errcode = '23514';
  end if;
  payment_reference := nullif(btrim(payment_row ->> 'reference_number'), '');
  payment_note := nullif(btrim(payment_row ->> 'note'), '');
  if payment_requires_reference and payment_reference is null then
    raise exception 'A reference number is required for the selected payment method.' using errcode = '23514';
  end if;
  if payment_type = 'CASH' then
    tendered_minor := nullif(payment_row ->> 'amount_tendered_minor', '')::bigint;
    if tendered_minor is null or tendered_minor < calculated_subtotal_minor then
      raise exception 'Cash tender must cover the sale total.' using errcode = '23514';
    end if;
    applied_minor := calculated_subtotal_minor;
    change_given_minor := tendered_minor - calculated_subtotal_minor;
  else
    applied_minor := nullif(payment_row ->> 'amount_minor', '')::bigint;
    if applied_minor is null or applied_minor <> calculated_subtotal_minor then
      raise exception 'The internal payment must exactly cover this sale.' using errcode = '23514';
    end if;
    tendered_minor := null;
    change_given_minor := null;
  end if;
  insert into public.payments (
    organization_id, sale_id, payment_method_id, payment_method_name_snapshot,
    payment_method_code_snapshot, payment_method_type_snapshot, amount_minor,
    amount_tendered_minor, change_given_minor, reference_number, note
  ) values (
    target_organization_id, new_sale_id, selected_payment_method_id, payment_name, payment_code,
    payment_type, applied_minor, tendered_minor, change_given_minor, payment_reference, payment_note
  );

  new_receipt_number := nextval('private.tindio_receipt_number_sequence'::regclass);
  insert into public.receipts (organization_id, sale_id, receipt_number)
  values (target_organization_id, new_sale_id, new_receipt_number);
  update public.checkout_requests
  set state = 'completed', sale_id = new_sale_id, completed_at = now()
  where id = checkout_request_id;

  return query select
    new_sale_id,
    new_receipt_number,
    calculated_subtotal_minor,
    coalesce(change_given_minor, 0),
    jsonb_build_array(jsonb_build_object(
      'payment_method_id', selected_payment_method_id,
      'name', payment_name,
      'code', payment_code,
      'type', payment_type,
      'amount_minor', applied_minor,
      'amount_tendered_minor', tendered_minor,
      'change_given_minor', change_given_minor,
      'reference_number', payment_reference,
      'note', payment_note
    )),
    false;
end;
$$;

revoke execute on function private.checkout_catalog_special_sale(uuid, uuid, uuid, uuid, jsonb, jsonb)
from public, anon, authenticated, service_role;

-- The established advanced-checkout routine owns discounts, loyalty, modifiers,
-- receipts and split payment rules. Its catalogue-only clauses are updated here
-- without disturbing the rest of that audited routine.
do $migration$
declare
  function_definition text;
  old_fragment text;
begin
  select pg_get_functiondef(
    'private.checkout_advanced_sale(uuid,uuid,uuid,uuid,jsonb,jsonb,uuid,integer,uuid,uuid,uuid,uuid)'::regprocedure
  ) into function_definition;

  old_fragment := $old$  product_name text; variant_name text; sku text; item_unit text; base_price bigint; modifier_price bigint; quantity integer;$old$;
  if position(old_fragment in function_definition) = 0 then raise exception 'Expected advanced checkout declaration was not found.'; end if;
  function_definition := replace(function_definition, old_fragment, $new$  product_name text; variant_name text; sku text; item_unit text; base_price bigint; modifier_price bigint; quantity numeric(14, 3);$new$);

  old_fragment := $old$select jsonb_agg(jsonb_build_object('product_id', item.value -> 'product_id', 'variant_id', coalesce(item.value -> 'variant_id', 'null'::jsonb), 'quantity', item.value -> 'quantity') order by item.ordinality) into normalized_items from jsonb_array_elements(target_items) with ordinality item(value, ordinality);$old$;
  if position(old_fragment in function_definition) = 0 then raise exception 'Expected advanced checkout normalization was not found.'; end if;
  function_definition := replace(function_definition, old_fragment, $new$select jsonb_agg(jsonb_build_object('product_id', item.value -> 'product_id', 'variant_id', coalesce(item.value -> 'variant_id', 'null'::jsonb), 'quantity', item.value -> 'quantity', 'unit_price_minor', coalesce(item.value -> 'unit_price_minor', 'null'::jsonb)) order by item.ordinality) into normalized_items from jsonb_array_elements(target_items) with ordinality item(value, ordinality);$new$);

  old_fragment := $old$coalesce(line ->> 'quantity', '') !~ '^[1-9][0-9]{0,3}$'$old$;
  if position(old_fragment in function_definition) = 0 then raise exception 'Expected advanced checkout quantity validation was not found.'; end if;
  function_definition := replace(function_definition, old_fragment, $new$coalesce(line ->> 'quantity', '') !~ '^(?:0|[1-9][0-9]{0,3})([.][0-9]{1,3})?'$new$);

  old_fragment := $old$quantity := (line ->> 'quantity')::integer;$old$;
  if position(old_fragment in function_definition) = 0 then raise exception 'Expected advanced checkout quantity cast was not found.'; end if;
  function_definition := replace(function_definition, old_fragment, $new$quantity := (line ->> 'quantity')::numeric(14, 3);
    if quantity <= 0 then raise exception 'Each checkout item must have a quantity greater than zero.' using errcode = '23514'; end if;$new$);

  old_fragment := $old$product.price_minor into product_name, variant_name, sku, item_unit, base_price$old$;
  if position(old_fragment in function_definition) = 0 then raise exception 'Expected advanced checkout simple product pricing was not found.'; end if;
  function_definition := replace(function_definition, old_fragment, $new$coalesce(setting.price_override_minor, product.price_minor) into product_name, variant_name, sku, item_unit, base_price$new$);

  old_fragment := $old$if base_price is null then raise exception 'Every checkout item must be active and available at this store.' using errcode = '23514'; end if;
    option_ids :=$old$;
  if position(old_fragment in function_definition) = 0 then raise exception 'Expected advanced checkout product guard was not found.'; end if;
  function_definition := replace(function_definition, old_fragment, $new$if base_price is null then raise exception 'Every checkout item must be active and available at this store.' using errcode = '23514'; end if;
    if quantity <> trunc(quantity) and not exists (select 1 from public.products product where product.id = (line ->> 'product_id')::uuid and product.organization_id = target_organization_id and product.allow_fractional_quantity) then raise exception 'This product must be sold in whole units.' using errcode = '23514'; end if;
    if exists (select 1 from public.products product where product.id = (line ->> 'product_id')::uuid and product.organization_id = target_organization_id and product.is_variable_price) then
      if jsonb_typeof(line -> 'unit_price_minor') <> 'number' or coalesce(line ->> 'unit_price_minor', '') !~ '^[1-9][0-9]{0,9}$' then raise exception 'Enter a supported manual price for this product.' using errcode = '23514'; end if;
      base_price := (line ->> 'unit_price_minor')::bigint;
    elsif line ? 'unit_price_minor' and line -> 'unit_price_minor' <> 'null'::jsonb then
      raise exception 'Manual pricing is not enabled for this product.' using errcode = '23514';
    end if;
    option_ids :=$new$);

  old_fragment := $old$subtotal := subtotal + (base_price + modifier_price) * quantity;$old$;
  if position(old_fragment in function_definition) = 0 then raise exception 'Expected advanced checkout line total was not found.'; end if;
  function_definition := replace(function_definition, old_fragment, $new$subtotal := subtotal + round((base_price + modifier_price)::numeric * quantity)::bigint;$new$);

  old_fragment := $old$(line ->> 'quantity')::integer, (line ->> 'base_price_minor')::bigint, (line ->> 'modifier_total_minor')::bigint, line -> 'modifiers', ((line ->> 'base_price_minor')::bigint + (line ->> 'modifier_total_minor')::bigint) * (line ->> 'quantity')::integer);$old$;
  if position(old_fragment in function_definition) = 0 then raise exception 'Expected advanced checkout sale item write was not found.'; end if;
  function_definition := replace(function_definition, old_fragment, $new$(line ->> 'quantity')::numeric(14, 3), (line ->> 'base_price_minor')::bigint, (line ->> 'modifier_total_minor')::bigint, line -> 'modifiers', round(((line ->> 'base_price_minor')::bigint + (line ->> 'modifier_total_minor')::bigint)::numeric * (line ->> 'quantity')::numeric(14, 3))::bigint);$new$);

  execute function_definition;
end;
$migration$;

do $migration$
declare
  function_definition text;
  old_fragment text;
begin
  select pg_get_functiondef(
    'private.checkout_sale(uuid,uuid,uuid,uuid,jsonb,jsonb)'::regprocedure
  ) into function_definition;
  old_fragment := $old$return query
  select *
  from private.checkout_sale_v1(
    target_organization_id,
    target_store_id,
    target_register_id,
    target_idempotency_key,
    target_items,
    target_payments
  );$old$;
  if position(old_fragment in function_definition) = 0 then raise exception 'Expected core checkout delegate was not found.'; end if;
  function_definition := replace(function_definition, old_fragment, $new$if exists (
    select 1
    from jsonb_array_elements(coalesce(target_items, '[]'::jsonb)) item(value)
    where coalesce(item.value ->> 'quantity', '') like '%.%'
      or (item.value ? 'unit_price_minor' and item.value -> 'unit_price_minor' <> 'null'::jsonb)
  ) then
    return query
    select *
    from private.checkout_catalog_special_sale(
      target_organization_id,
      target_store_id,
      target_register_id,
      target_idempotency_key,
      target_items,
      target_payments
    );
    return;
  end if;

  return query
  select *
  from private.checkout_sale_v1(
    target_organization_id,
    target_store_id,
    target_register_id,
    target_idempotency_key,
    target_items,
    target_payments
  );$new$);
  execute function_definition;
end;
$migration$;

comment on column public.sale_items.quantity
is 'Quantity sold in the product base unit. Supports exact three-decimal fractional quantities.';
comment on function private.quote_checkout_subtotal(uuid, uuid, jsonb)
is 'Server-authoritative subtotal quote with store price overrides, variable-price permission, and fractional-quantity enforcement.';

commit;
