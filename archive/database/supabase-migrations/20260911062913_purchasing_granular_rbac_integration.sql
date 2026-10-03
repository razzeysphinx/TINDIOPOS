-- Phase 10: retain the canonical purchasing procedures while adding their
-- explicit granular capability alternative to the legacy authorization path.
begin;

-- Checked-in canonical purchasing procedures appear below. Only their
-- authorization guards add the explicit granular capability alternative.

create or replace function private.create_supplier(target_organization_id uuid, target_name text, target_contact_name text, target_email text, target_phone text, target_address text, target_notes text) returns uuid language plpgsql security definer set search_path = '' as $$ declare supplier_id uuid; begin
 if (select auth.uid()) is null or (not (select private.has_permission(target_organization_id, 'inventory.manage')) and not (select private.has_inventory_capability(target_organization_id, 'purchasing.suppliers.manage'))) then raise exception 'Inventory permission is required.' using errcode='42501'; end if;
 insert into public.suppliers (organization_id,name,contact_name,email,phone,address,notes) values (target_organization_id,nullif(btrim(target_name),''),nullif(btrim(target_contact_name),''),nullif(btrim(target_email),''),nullif(btrim(target_phone),''),nullif(btrim(target_address),''),nullif(btrim(target_notes),'')) returning id into supplier_id; return supplier_id; end; $$;

create or replace function public.update_supplier(
  target_organization_id uuid,
  target_supplier_id uuid,
  target_name text,
  target_contact_name text,
  target_email text,
  target_phone text,
  target_address text,
  target_notes text,
  target_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := nullif(btrim(target_name), '');
  normalized_email text := nullif(btrim(target_email), '');
  actor_employee_id uuid;
begin
  if (select auth.uid()) is null
    or (not (select private.has_permission(target_organization_id, 'inventory.manage')) and not (select private.has_inventory_capability(target_organization_id, 'purchasing.suppliers.manage'))) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;

  if normalized_name is null or char_length(normalized_name) > 160 then
    raise exception 'Enter a supplier name with at most 160 characters.' using errcode = '22023';
  end if;

  if normalized_email is not null
    and (char_length(normalized_email) > 320 or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'Enter a valid supplier email address.' using errcode = '22023';
  end if;

  if char_length(btrim(target_contact_name)) > 160
    or char_length(btrim(target_phone)) > 40
    or char_length(btrim(target_address)) > 1000
    or char_length(btrim(target_notes)) > 2000 then
    raise exception 'One or more supplier fields are too long.' using errcode = '22023';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active';

  update public.suppliers supplier
  set
    name = normalized_name,
    contact_name = nullif(btrim(target_contact_name), ''),
    email = normalized_email,
    phone = nullif(btrim(target_phone), ''),
    address = nullif(btrim(target_address), ''),
    notes = nullif(btrim(target_notes), ''),
    is_active = target_is_active
  where supplier.id = target_supplier_id
    and supplier.organization_id = target_organization_id;

  if not found then
    raise exception 'Select a supplier in this organization.' using errcode = '23503';
  end if;

  perform private.write_audit_log(
    target_organization_id,
    'SUPPLIER_UPDATED',
    'inventory.manage',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'supplier_id', target_supplier_id,
      'is_active', target_is_active
    )
  );

  return target_supplier_id;
end;
$$;

create or replace function private.import_suppliers_csv(
  target_organization_id uuid,
  target_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  import_row record;
  row_json jsonb;
  row_number integer;
  row_name text;
  actor_employee_id uuid;
  seen_names text[] := '{}';
  imported_count integer := 0;
begin
  if (select auth.uid()) is null
    or (not (select private.has_permission(target_organization_id, 'inventory.manage')) and not (select private.has_inventory_capability(target_organization_id, 'purchasing.suppliers.manage'))) then
    raise exception 'Inventory management permission is required.' using errcode = '42501';
  end if;
  if jsonb_typeof(target_rows) <> 'array' or jsonb_array_length(target_rows) not between 1 and 500 then
    raise exception 'Import between 1 and 500 supplier rows at a time.' using errcode = '22023';
  end if;
  select employee.id into actor_employee_id from public.employees employee where employee.organization_id = target_organization_id and employee.profile_id = (select auth.uid()) and employee.status = 'active' limit 1;

  for import_row in select value, ordinality from jsonb_array_elements(target_rows) with ordinality loop
    row_json := import_row.value;
    row_number := case when coalesce(row_json ->> 'row_number', '') ~ '^[1-9][0-9]*$' then (row_json ->> 'row_number')::integer else import_row.ordinality::integer end;
    if jsonb_typeof(row_json) <> 'object' then raise exception 'CSV row % must be an object.', row_number using errcode = '22023'; end if;
    row_name := lower(btrim(coalesce(row_json ->> 'name', '')));
    if char_length(row_name) not between 1 and 160 then raise exception 'CSV row % needs a supplier name of at most 160 characters.', row_number using errcode = '22023'; end if;
    if char_length(btrim(coalesce(row_json ->> 'contact_name', ''))) > 160 or char_length(btrim(coalesce(row_json ->> 'email', ''))) > 320 or char_length(btrim(coalesce(row_json ->> 'phone', ''))) > 40 or char_length(btrim(coalesce(row_json ->> 'address', ''))) > 1000 or char_length(btrim(coalesce(row_json ->> 'notes', ''))) > 2000 then raise exception 'CSV row % has a field that is too long.', row_number using errcode = '22023'; end if;
    if nullif(btrim(coalesce(row_json ->> 'email', '')), '') is not null and btrim(row_json ->> 'email') !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'CSV row % has an invalid email address.', row_number using errcode = '22023'; end if;
    if row_name = any(seen_names) then raise exception 'CSV row % repeats a supplier name in this file.', row_number using errcode = '23505'; end if;
    if exists (select 1 from public.suppliers supplier where supplier.organization_id = target_organization_id and lower(btrim(supplier.name)) = row_name) then raise exception 'CSV row % matches an existing supplier. Update that supplier instead.', row_number using errcode = '23505'; end if;
    seen_names := array_append(seen_names, row_name);
  end loop;

  for import_row in select value from jsonb_array_elements(target_rows) loop
    insert into public.suppliers (organization_id, name, contact_name, email, phone, address, notes)
    values (target_organization_id, btrim(import_row.value ->> 'name'), nullif(btrim(coalesce(import_row.value ->> 'contact_name', '')), ''), nullif(lower(btrim(coalesce(import_row.value ->> 'email', ''))), ''), nullif(btrim(coalesce(import_row.value ->> 'phone', '')), ''), nullif(btrim(coalesce(import_row.value ->> 'address', '')), ''), nullif(btrim(coalesce(import_row.value ->> 'notes', '')), ''));
    imported_count := imported_count + 1;
  end loop;
  perform private.write_audit_log(target_organization_id, 'SUPPLIERS_IMPORTED', 'inventory.manage', actor_employee_id, null, null, null, null, null, 'CSV import', jsonb_build_object('row_count', imported_count));
  return imported_count;
end;
$$;

create or replace function private.create_purchase_order(
  target_organization_id uuid,
  target_store_id uuid,
  target_supplier_id uuid,
  target_notes text,
  target_expected_at date,
  target_lines jsonb,
  target_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  order_id uuid;
  existing_order public.purchase_orders%rowtype;
  line jsonb;
  product_row record;
  purchase_unit_row record;
  next_number bigint;
  normalized_note text;
  requested_lines jsonb;
  persisted_lines jsonb;
begin
  if (select auth.uid()) is null
     or (not (select private.has_permission(target_organization_id, 'inventory.manage')) and not (select private.has_inventory_capability(target_organization_id, 'purchasing.po.create'))) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;

  if target_operation_id is null then
    raise exception 'A stable purchase-order operation ID is required.' using errcode = '23514';
  end if;

  if target_lines is null
     or jsonb_typeof(target_lines) <> 'array'
     or jsonb_array_length(target_lines) not between 1 and 100 then
    raise exception 'A purchase order needs one to 100 items.' using errcode = '23514';
  end if;

  for line in select value from jsonb_array_elements(target_lines)
  loop
    if coalesce(line ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or (nullif(line ->> 'variant_id', '') is not null and coalesce(line ->> 'variant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
       or coalesce(line ->> 'purchase_unit_code', '') !~ '^[A-Za-z0-9][A-Za-z0-9 _-]{0,23}$'
       or coalesce(line ->> 'quantity', '') !~ '^\d+(\.\d{1,3})?$'
       or (line ->> 'quantity')::numeric <= 0
       or coalesce(line ->> 'unit_cost_minor', '') !~ '^\d+$' then
      raise exception 'Purchase order items, units, quantities, and costs must be valid.' using errcode = '23514';
    end if;
  end loop;

  if exists (
    select 1
    from (
      select lower(btrim(value ->> 'product_id')) as product_id,
             coalesce(nullif(lower(btrim(value ->> 'variant_id')), ''), '') as variant_id,
             count(*) as line_count
      from jsonb_array_elements(target_lines)
      group by 1, 2
    ) duplicate_line
    where duplicate_line.line_count > 1
  ) then
    raise exception 'Each item can appear only once in a purchase order.' using errcode = '23514';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id', normalized.product_id,
        'variant_id', normalized.variant_id,
        'purchase_unit_code', normalized.purchase_unit_code,
        'quantity', normalized.quantity,
        'unit_cost_minor', normalized.unit_cost_minor
      ) order by normalized.product_id, normalized.variant_id
    ),
    '[]'::jsonb
  )
  into requested_lines
  from (
    select lower(btrim(value ->> 'product_id')) as product_id,
           coalesce(nullif(lower(btrim(value ->> 'variant_id')), ''), '') as variant_id,
           lower(btrim(value ->> 'purchase_unit_code')) as purchase_unit_code,
           ((value ->> 'quantity')::numeric(14,3))::text as quantity,
           ((value ->> 'unit_cost_minor')::bigint)::text as unit_cost_minor
    from jsonb_array_elements(target_lines)
  ) normalized;

  normalized_note := nullif(btrim(target_notes), '');
  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;

  select * into existing_order
  from public.purchase_orders purchase_order
  where purchase_order.organization_id = target_organization_id
    and purchase_order.operation_id = target_operation_id
  for update;

  if found then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'product_id', purchase_line.product_id::text,
          'variant_id', coalesce(purchase_line.variant_id::text, ''),
          'purchase_unit_code', purchase_line.purchase_unit_code_snapshot,
          'quantity', purchase_line.ordered_quantity::text,
          'unit_cost_minor', purchase_line.unit_cost_minor::text
        ) order by purchase_line.product_id::text, coalesce(purchase_line.variant_id::text, '')
      ),
      '[]'::jsonb
    ) into persisted_lines
    from public.purchase_order_lines purchase_line
    where purchase_line.organization_id = target_organization_id
      and purchase_line.purchase_order_id = existing_order.id;

    if existing_order.store_id = target_store_id
       and existing_order.supplier_id = target_supplier_id
       and existing_order.created_by_employee_id = actor_id
       and existing_order.requested_expected_at is not distinct from target_expected_at
       and existing_order.notes is not distinct from normalized_note
       and persisted_lines = requested_lines then
      return existing_order.id;
    end if;

    raise exception 'This operation ID is already assigned to a different purchase order request.' using errcode = '23505';
  end if;

  if not exists (
    select 1
    from public.suppliers supplier
    where supplier.id = target_supplier_id
      and supplier.organization_id = target_organization_id
      and supplier.is_active
  ) then
    raise exception 'Choose an active supplier.' using errcode = '23514';
  end if;

  next_number := nextval('private.tindio_purchase_order_number_sequence'::regclass);
  insert into public.purchase_orders (
    organization_id, store_id, supplier_id, order_number, status, notes,
    expected_at, requested_expected_at, ordered_at, created_by_employee_id, operation_id
  ) values (
    target_organization_id, target_store_id, target_supplier_id, next_number,
    'ordered', normalized_note, target_expected_at, target_expected_at, now(), actor_id, target_operation_id
  ) returning id into order_id;

  for line in select value from jsonb_array_elements(target_lines)
  loop
    select product.name as product_name, variant.name as variant_name
    into product_row
    from public.products product
    left join public.product_variants variant
      on variant.id = nullif(line ->> 'variant_id', '')::uuid
      and variant.product_id = product.id
      and variant.organization_id = product.organization_id
    where product.id = (line ->> 'product_id')::uuid
      and product.organization_id = target_organization_id
      and product.status = 'active'
      and product.track_inventory
      and (nullif(line ->> 'variant_id', '') is null or variant.id is not null)
      and exists (
        select 1 from public.product_store_settings store_setting
        where store_setting.organization_id = target_organization_id
          and store_setting.store_id = target_store_id
          and store_setting.product_id = product.id
          and store_setting.is_available
      );

    if not found then
      raise exception 'Every order item must be an active tracked item available in the receiving store.' using errcode = '23514';
    end if;

    select product_unit.unit_code, product_unit.unit_name, product_unit.factor_to_base
    into purchase_unit_row
    from public.product_units product_unit
    where product_unit.organization_id = target_organization_id
      and product_unit.product_id = (line ->> 'product_id')::uuid
      and product_unit.unit_code = lower(btrim(line ->> 'purchase_unit_code'))
      and (product_unit.is_purchase_unit or product_unit.is_base);

    if not found then
      raise exception 'Choose a configured purchase unit for every order item.' using errcode = '23514';
    end if;

    insert into public.purchase_order_lines (
      organization_id, purchase_order_id, product_id, variant_id,
      product_name_snapshot, variant_name_snapshot, unit_snapshot,
      purchase_unit_code_snapshot, purchase_unit_factor_to_base,
      ordered_quantity, unit_cost_minor
    ) values (
      target_organization_id, order_id, (line ->> 'product_id')::uuid,
      nullif(line ->> 'variant_id', '')::uuid, product_row.product_name,
      product_row.variant_name, purchase_unit_row.unit_name,
      purchase_unit_row.unit_code, purchase_unit_row.factor_to_base,
      (line ->> 'quantity')::numeric(14,3), (line ->> 'unit_cost_minor')::bigint
    );
  end loop;

  return order_id;
end;
$$;

commit;
create or replace function private.cancel_purchase_order(
  target_organization_id uuid,
  target_purchase_order_id uuid,
  target_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  purchase public.purchase_orders%rowtype;
  actor_id uuid;
  normalized_note text;
begin
  if (select auth.uid()) is null
     or (not (select private.has_permission(target_organization_id, 'inventory.manage')) and not (select private.has_inventory_capability(target_organization_id, 'purchasing.po.create'))) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;

  select *
  into purchase
  from public.purchase_orders purchase_order
  where purchase_order.id = target_purchase_order_id
    and purchase_order.organization_id = target_organization_id
    and purchase_order.status in ('draft', 'ordered', 'partially_received')
  for update;

  if purchase.id is null then
    raise exception 'This purchase order cannot be cancelled.' using errcode = '23514';
  end if;

  actor_id := private.inventory_actor(target_organization_id, purchase.store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;

  normalized_note := nullif(btrim(target_note), '');
  update public.purchase_orders
  set status = 'cancelled'
  where id = purchase.id;

  perform private.write_audit_log(
    target_organization_id,
    'PURCHASE_ORDER_CANCELLED',
    'inventory.manage',
    actor_id,
    null,
    purchase.store_id,
    null,
    null,
    null,
    normalized_note,
    jsonb_build_object('purchase_order_id', purchase.id, 'remaining_quantity', (
      select coalesce(sum(ordered_quantity - received_quantity), 0)
      from public.purchase_order_lines purchase_line
      where purchase_line.purchase_order_id = purchase.id
    ))
  );

  return purchase.id;
end;
$$;

create or replace function private.receive_purchase_order(
  target_organization_id uuid,
  target_purchase_order_id uuid,
  target_lines jsonb,
  target_note text,
  target_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  purchase public.purchase_orders%rowtype;
  existing_receipt public.goods_receipts%rowtype;
  actor_id uuid;
  receipt_id uuid;
  receipt_number bigint;
  line jsonb;
  po_line public.purchase_order_lines%rowtype;
  quantity_received numeric(14,3);
  base_quantity_received numeric(14,6);
  total_remaining numeric(14,3);
  normalized_note text;
  requested_lines jsonb;
  persisted_lines jsonb;
begin
  if (select auth.uid()) is null
     or (not (select private.has_permission(target_organization_id, 'inventory.manage')) and not (select private.has_inventory_capability(target_organization_id, 'purchasing.receive'))) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;

  if target_operation_id is null then
    raise exception 'A stable goods-receipt operation ID is required.' using errcode = '23514';
  end if;

  if target_lines is null
     or jsonb_typeof(target_lines) <> 'array'
     or jsonb_array_length(target_lines) not between 1 and 100 then
    raise exception 'A receipt needs one to 100 items.' using errcode = '23514';
  end if;

  for line in select value from jsonb_array_elements(target_lines)
  loop
    if coalesce(line ->> 'purchase_order_line_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(line ->> 'quantity', '') !~ '^\d+(\.\d{1,3})?$'
       or (line ->> 'quantity')::numeric <= 0 then
      raise exception 'Receipt quantities must be positive.' using errcode = '23514';
    end if;
  end loop;

  if exists (
    select 1
    from (
      select lower(btrim(value ->> 'purchase_order_line_id')) as purchase_order_line_id, count(*) as line_count
      from jsonb_array_elements(target_lines)
      group by 1
    ) duplicate_line
    where duplicate_line.line_count > 1
  ) then
    raise exception 'Each order line can be received once per receipt.' using errcode = '23514';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'purchase_order_line_id', normalized.purchase_order_line_id,
        'quantity', normalized.quantity
      )
      order by normalized.purchase_order_line_id
    ),
    '[]'::jsonb
  )
  into requested_lines
  from (
    select
      lower(btrim(value ->> 'purchase_order_line_id')) as purchase_order_line_id,
      ((value ->> 'quantity')::numeric(14,3))::text as quantity
    from jsonb_array_elements(target_lines)
  ) normalized;

  normalized_note := nullif(btrim(target_note), '');

  select *
  into existing_receipt
  from public.goods_receipts goods_receipt
  where goods_receipt.organization_id = target_organization_id
    and goods_receipt.operation_id = target_operation_id
  for update;

  if found then
    select *
    into purchase
    from public.purchase_orders purchase_order
    where purchase_order.id = target_purchase_order_id
      and purchase_order.organization_id = target_organization_id
    for update;

    actor_id := private.inventory_actor(target_organization_id, purchase.store_id);
    if purchase.id is not null
       and actor_id is not null then
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'purchase_order_line_id', receipt_line.purchase_order_line_id::text,
            'quantity', receipt_line.quantity_received::text
          )
          order by receipt_line.purchase_order_line_id::text
        ),
        '[]'::jsonb
      )
      into persisted_lines
      from public.goods_receipt_lines receipt_line
      where receipt_line.organization_id = target_organization_id
        and receipt_line.goods_receipt_id = existing_receipt.id;

      if existing_receipt.purchase_order_id = target_purchase_order_id
         and existing_receipt.store_id = purchase.store_id
         and existing_receipt.received_by_employee_id = actor_id
         and existing_receipt.note is not distinct from normalized_note
         and persisted_lines = requested_lines then
        return existing_receipt.id;
      end if;
    end if;

    raise exception 'This operation ID is already assigned to a different goods receipt request.' using errcode = '23505';
  end if;

  select *
  into purchase
  from public.purchase_orders purchase_order
  where purchase_order.id = target_purchase_order_id
    and purchase_order.organization_id = target_organization_id
    and purchase_order.status in ('ordered', 'partially_received')
  for update;

  if purchase.id is null then
    raise exception 'This purchase order cannot be received.' using errcode = '23514';
  end if;

  actor_id := private.inventory_actor(target_organization_id, purchase.store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;

  receipt_number := nextval('private.tindio_goods_receipt_number_sequence'::regclass);
  insert into public.goods_receipts (
    organization_id,
    purchase_order_id,
    store_id,
    received_by_employee_id,
    note,
    receipt_number,
    operation_id
  )
  values (
    target_organization_id,
    purchase.id,
    purchase.store_id,
    actor_id,
    normalized_note,
    receipt_number,
    target_operation_id
  )
  returning id into receipt_id;

  for line in select value from jsonb_array_elements(target_lines)
  loop
    select *
    into po_line
    from public.purchase_order_lines purchase_line
    where purchase_line.id = (line ->> 'purchase_order_line_id')::uuid
      and purchase_line.purchase_order_id = purchase.id
      and purchase_line.organization_id = target_organization_id
    for update;

    if po_line.id is null then
      raise exception 'A receipt line does not belong to this purchase order.' using errcode = '23514';
    end if;

    quantity_received := (line ->> 'quantity')::numeric(14,3);
    if po_line.received_quantity + quantity_received > po_line.ordered_quantity then
      raise exception 'Received quantity cannot exceed the ordered quantity.' using errcode = '23514';
    end if;

    base_quantity_received := quantity_received * po_line.purchase_unit_factor_to_base;
    if base_quantity_received <> round(base_quantity_received, 3) then
      raise exception 'This received quantity cannot be expressed in the product base unit to three decimal places.' using errcode = '23514';
    end if;

    insert into public.goods_receipt_lines (
      organization_id,
      goods_receipt_id,
      purchase_order_line_id,
      quantity_received
    )
    values (
      target_organization_id,
      receipt_id,
      po_line.id,
      quantity_received
    );

    update public.purchase_order_lines
    set received_quantity = received_quantity + quantity_received
    where id = po_line.id;

    perform private.apply_inventory_change_v2(
      target_organization_id,
      purchase.store_id,
      po_line.product_id,
      po_line.variant_id,
      round(base_quantity_received, 3),
      'RECEIPT',
      actor_id,
      format('Goods receipt GR-%s', lpad(receipt_number::text, 6, '0')),
      'goods_receipt',
      receipt_id,
      round(po_line.unit_cost_minor::numeric / po_line.purchase_unit_factor_to_base)::bigint
    );
  end loop;

  select coalesce(sum(ordered_quantity - received_quantity), 0)
  into total_remaining
  from public.purchase_order_lines purchase_line
  where purchase_line.purchase_order_id = purchase.id;

  update public.purchase_orders
  set
    status = case when total_remaining = 0 then 'received' else 'partially_received' end,
    received_at = now(),
    received_by_employee_id = actor_id
  where id = purchase.id;

  perform private.write_audit_log(
    target_organization_id,
    'PURCHASE_ORDER_RECEIVED',
    'inventory.manage',
    actor_id,
    null,
    purchase.store_id,
    null,
    null,
    null,
    normalized_note,
    jsonb_build_object(
      'purchase_order_id', purchase.id,
      'goods_receipt_id', receipt_id,
      'goods_receipt_number', receipt_number,
      'operation_id', target_operation_id
    )
  );

  return receipt_id;
end;
$$;

create or replace function private.return_to_supplier(
  target_organization_id uuid,
  target_store_id uuid,
  target_supplier_id uuid,
  target_lines jsonb,
  target_note text,
  target_operation_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid;
  return_id uuid;
  existing_return public.supplier_returns%rowtype;
  line jsonb;
  stock_level public.inventory_levels%rowtype;
  line_quantity numeric(14,3);
  normalized_note text;
begin
  if (select auth.uid()) is null or (not (select private.has_permission(target_organization_id, 'inventory.manage')) and not (select private.has_inventory_capability(target_organization_id, 'purchasing.return'))) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;
  if target_operation_id is null then
    raise exception 'An operation ID is required for a supplier return.' using errcode = '23514';
  end if;
  if target_lines is null or jsonb_typeof(target_lines) <> 'array' or jsonb_array_length(target_lines) not between 1 and 100 then
    raise exception 'A supplier return needs one to 100 items.' using errcode = '23514';
  end if;

  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.suppliers supplier
    where supplier.id = target_supplier_id
      and supplier.organization_id = target_organization_id
      and supplier.is_active
  ) then
    raise exception 'Choose an active supplier.' using errcode = '23514';
  end if;

  normalized_note := nullif(btrim(target_note), '');
  select * into existing_return
  from public.supplier_returns supplier_return
  where supplier_return.organization_id = target_organization_id
    and supplier_return.operation_id = target_operation_id;

  if found then
    if existing_return.store_id is distinct from target_store_id
      or existing_return.supplier_id is distinct from target_supplier_id
      or existing_return.note is distinct from normalized_note then
      raise exception 'This operation ID was already used for a different supplier return.' using errcode = '23514';
    end if;
    return existing_return.id;
  end if;

  insert into public.supplier_returns (
    organization_id, supplier_id, store_id, returned_by_employee_id, note, operation_id
  ) values (
    target_organization_id, target_supplier_id, target_store_id, actor_id, normalized_note, target_operation_id
  ) on conflict (organization_id, operation_id) where operation_id is not null do nothing
  returning id into return_id;

  if return_id is null then
    select * into existing_return
    from public.supplier_returns supplier_return
    where supplier_return.organization_id = target_organization_id
      and supplier_return.operation_id = target_operation_id;
    if existing_return.store_id is distinct from target_store_id
      or existing_return.supplier_id is distinct from target_supplier_id
      or existing_return.note is distinct from normalized_note then
      raise exception 'This operation ID was already used for a different supplier return.' using errcode = '23514';
    end if;
    return existing_return.id;
  end if;

  for line in
    select value
    from jsonb_array_elements(target_lines)
    order by value->>'product_id', coalesce(value->>'variant_id', '')
  loop
    if coalesce(line->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(line->>'quantity', '') !~ '^\d+(\.\d{1,3})?$'
      or (line->>'quantity')::numeric <= 0 then
      raise exception 'Supplier-return lines must include valid items and quantities.' using errcode = '23514';
    end if;

    line_quantity := (line->>'quantity')::numeric(14,3);
    select * into stock_level
    from public.inventory_levels level
    where level.organization_id = target_organization_id
      and level.store_id = target_store_id
      and level.product_id = (line->>'product_id')::uuid
      and level.variant_id is not distinct from nullif(line->>'variant_id', '')::uuid
    for update;

    if stock_level.id is null or stock_level.quantity < line_quantity then
      raise exception 'Stock is insufficient for this supplier return.' using errcode = '23514';
    end if;

    insert into public.supplier_return_lines (
      organization_id, supplier_return_id, product_id, variant_id, quantity, unit_cost_minor
    ) values (
      target_organization_id, return_id, stock_level.product_id, stock_level.variant_id,
      line_quantity, stock_level.average_cost_minor
    );
    perform private.apply_inventory_change_v2(
      target_organization_id, target_store_id, stock_level.product_id, stock_level.variant_id,
      -line_quantity, 'SUPPLIER_RETURN', actor_id, 'Returned to supplier', 'supplier_return',
      return_id, stock_level.average_cost_minor
    );
  end loop;

  perform private.write_audit_log(
    target_organization_id, 'SUPPLIER_RETURN_CREATED', 'inventory.manage', actor_id, null,
    target_store_id, null, null, null, target_note,
    jsonb_build_object('supplier_return_id', return_id, 'supplier_id', target_supplier_id, 'operation_id', target_operation_id)
  );
  return return_id;
end;
$$;

-- Read policies use the same capability and central store-scope helpers as
-- the command procedures.  A purchasing capability never bypasses tenant or
-- branch scope, and suppliers remain organization-scoped configuration.
drop policy if exists inventory_levels_select_authorized_scope on public.inventory_levels;
create policy inventory_levels_select_authorized_scope on public.inventory_levels
  for select to authenticated
  using (
    (
      (select private.has_permission(organization_id, 'inventory.view'))
      or (select private.has_permission(organization_id, 'inventory.count'))
      or (select private.has_permission(organization_id, 'inventory.manage'))
      or (select private.has_any_inventory_capability(
        organization_id,
        array['purchasing.po.create', 'purchasing.receive', 'purchasing.return']
      ))
    )
    and (select private.has_store_read_scope(organization_id, store_id))
  );

drop policy if exists suppliers_select_inventory_manager on public.suppliers;
drop policy if exists suppliers_select_purchasing_scope on public.suppliers;
create policy suppliers_select_purchasing_scope on public.suppliers
  for select to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array[
        'purchasing.view',
        'purchasing.po.create',
        'purchasing.receive',
        'purchasing.suppliers.manage',
        'purchasing.return'
      ]
    ))
  );

drop policy if exists purchase_orders_select_inventory_manager on public.purchase_orders;
drop policy if exists purchase_orders_select_purchasing_scope on public.purchase_orders;
create policy purchase_orders_select_purchasing_scope on public.purchase_orders
  for select to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['purchasing.view', 'purchasing.po.create', 'purchasing.receive']
    ))
    and (select private.has_store_read_scope(organization_id, store_id))
  );

drop policy if exists purchase_order_lines_select_inventory_manager on public.purchase_order_lines;
drop policy if exists purchase_order_lines_select_purchasing_scope on public.purchase_order_lines;
create policy purchase_order_lines_select_purchasing_scope on public.purchase_order_lines
  for select to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['purchasing.view', 'purchasing.po.create', 'purchasing.receive']
    ))
    and (select private.has_purchase_order_read_scope(organization_id, purchase_order_id))
  );

drop policy if exists goods_receipts_select_inventory_manager on public.goods_receipts;
drop policy if exists goods_receipts_select_authorized_scope on public.goods_receipts;
drop policy if exists goods_receipts_select_purchasing_scope on public.goods_receipts;
create policy goods_receipts_select_purchasing_scope on public.goods_receipts
  for select to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['purchasing.view', 'purchasing.receive']
    ))
    and (select private.has_store_read_scope(organization_id, store_id))
  );

drop policy if exists goods_receipt_lines_select_inventory_manager on public.goods_receipt_lines;
drop policy if exists goods_receipt_lines_select_authorized_scope on public.goods_receipt_lines;
drop policy if exists goods_receipt_lines_select_purchasing_scope on public.goods_receipt_lines;
create policy goods_receipt_lines_select_purchasing_scope on public.goods_receipt_lines
  for select to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['purchasing.view', 'purchasing.receive']
    ))
    and exists (
      select 1
      from public.goods_receipts goods_receipt
      where goods_receipt.id = goods_receipt_lines.goods_receipt_id
        and goods_receipt.organization_id = goods_receipt_lines.organization_id
        and (select private.has_store_read_scope(goods_receipt.organization_id, goods_receipt.store_id))
    )
  );

drop policy if exists supplier_returns_select_manager on public.supplier_returns;
drop policy if exists supplier_returns_select_authorized_scope on public.supplier_returns;
drop policy if exists supplier_returns_select_purchasing_scope on public.supplier_returns;
create policy supplier_returns_select_purchasing_scope on public.supplier_returns
  for select to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['purchasing.view', 'purchasing.return']
    ))
    and (select private.has_store_read_scope(organization_id, store_id))
  );

drop policy if exists supplier_return_lines_select_manager on public.supplier_return_lines;
drop policy if exists supplier_return_lines_select_authorized_scope on public.supplier_return_lines;
drop policy if exists supplier_return_lines_select_purchasing_scope on public.supplier_return_lines;
create policy supplier_return_lines_select_purchasing_scope on public.supplier_return_lines
  for select to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['purchasing.view', 'purchasing.return']
    ))
    and exists (
      select 1
      from public.supplier_returns supplier_return
      where supplier_return.id = supplier_return_lines.supplier_return_id
        and supplier_return.organization_id = supplier_return_lines.organization_id
        and (select private.has_store_read_scope(supplier_return.organization_id, supplier_return.store_id))
    )
  );

comment on policy suppliers_select_purchasing_scope on public.suppliers is
  'Purchasing capability read scope for tenant suppliers; write commands remain RPC-only.';
comment on policy purchase_orders_select_purchasing_scope on public.purchase_orders is
  'Purchasing capability read scope with centralized organization and store enforcement.';
comment on policy goods_receipts_select_purchasing_scope on public.goods_receipts is
  'Purchasing capability receipt history scope with centralized organization and store enforcement.';
comment on policy supplier_returns_select_purchasing_scope on public.supplier_returns is
  'Purchasing capability supplier-return history scope with centralized organization and store enforcement.';

notify pgrst, 'reload schema';

commit;
