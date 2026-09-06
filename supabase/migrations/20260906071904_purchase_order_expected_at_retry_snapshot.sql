-- Preserve the exact optional expected-date request separately from the
-- supplier lead-time default that is applied by the existing INSERT trigger.
begin;

alter table public.purchase_orders
  add column if not exists requested_expected_at date;

update public.purchase_orders
set requested_expected_at = expected_at
where requested_expected_at is null;

comment on column public.purchase_orders.requested_expected_at is
  'The explicit expected date supplied with the purchase-order command. Null means the supplier lead-time default was requested.';

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
     or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
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
