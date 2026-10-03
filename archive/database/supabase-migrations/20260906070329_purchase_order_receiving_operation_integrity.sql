-- Phase 2: make purchasing documents durable operational records.
-- A purchase order records intent only. A goods receipt is the idempotent,
-- traceable command that changes inventory through the canonical ledger.
begin;

create sequence if not exists private.tindio_goods_receipt_number_sequence;
revoke all on sequence private.tindio_goods_receipt_number_sequence from public, anon, authenticated, service_role;

alter table public.purchase_orders
  add column if not exists operation_id uuid;

update public.purchase_orders
set operation_id = id
where operation_id is null;

alter table public.purchase_orders
  alter column operation_id set not null;

alter table public.purchase_orders
  drop constraint if exists purchase_orders_organization_operation_unique;

alter table public.purchase_orders
  add constraint purchase_orders_organization_operation_unique
  unique (organization_id, operation_id);

alter table public.purchase_order_lines
  add column if not exists purchase_unit_code_snapshot text,
  add column if not exists purchase_unit_factor_to_base numeric(14,3);

update public.purchase_order_lines
set
  purchase_unit_code_snapshot = coalesce(nullif(lower(btrim(unit_snapshot)), ''), 'base'),
  purchase_unit_factor_to_base = 1
where purchase_unit_code_snapshot is null
   or purchase_unit_factor_to_base is null;

alter table public.purchase_order_lines
  alter column purchase_unit_code_snapshot set not null,
  alter column purchase_unit_factor_to_base set not null;

alter table public.purchase_order_lines
  drop constraint if exists purchase_order_lines_purchase_unit_factor_positive,
  add constraint purchase_order_lines_purchase_unit_factor_positive
    check (purchase_unit_factor_to_base > 0 and purchase_unit_factor_to_base = round(purchase_unit_factor_to_base, 3));

alter table public.goods_receipts
  add column if not exists receipt_number bigint,
  add column if not exists operation_id uuid;

update public.goods_receipts
set receipt_number = nextval('private.tindio_goods_receipt_number_sequence'::regclass)
where receipt_number is null;

update public.goods_receipts
set operation_id = id
where operation_id is null;

alter table public.goods_receipts
  alter column receipt_number set not null,
  alter column operation_id set not null;

alter table public.goods_receipts
  drop constraint if exists goods_receipts_organization_number_unique,
  drop constraint if exists goods_receipts_organization_operation_unique;

alter table public.goods_receipts
  add constraint goods_receipts_organization_number_unique
    unique (organization_id, receipt_number),
  add constraint goods_receipts_organization_operation_unique
    unique (organization_id, operation_id);

create index if not exists goods_receipts_store_received_idx
  on public.goods_receipts (organization_id, store_id, received_at desc);

comment on column public.purchase_orders.operation_id is
  'Stable client-generated operation key. Retrying the same purchase-order command returns this document instead of creating another order.';
comment on column public.purchase_order_lines.purchase_unit_code_snapshot is
  'Configured product purchase-unit code captured when the order was created.';
comment on column public.purchase_order_lines.purchase_unit_factor_to_base is
  'Exact conversion from ordered/received purchase units into the immutable inventory base unit.';
comment on column public.goods_receipts.receipt_number is
  'Organization-scoped sequential human goods-receipt reference, displayed as GR-000001.';
comment on column public.goods_receipts.operation_id is
  'Stable client-generated operation key. Retrying the same receiving command returns this receipt without posting inventory twice.';

-- The public RPC signatures intentionally change. Keeping the old no-key
-- variants would leave a callable path that can create duplicate documents.
drop function if exists public.create_purchase_order(uuid, uuid, uuid, text, date, jsonb);
drop function if exists private.create_purchase_order(uuid, uuid, uuid, text, date, jsonb);
drop function if exists public.receive_purchase_order(uuid, uuid, jsonb, text);
drop function if exists private.receive_purchase_order(uuid, uuid, jsonb, text);

create function private.create_purchase_order(
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
      select
        lower(btrim(value ->> 'product_id')) as product_id,
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
      )
      order by normalized.product_id, normalized.variant_id
    ),
    '[]'::jsonb
  )
  into requested_lines
  from (
    select
      lower(btrim(value ->> 'product_id')) as product_id,
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

  select *
  into existing_order
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
        )
        order by purchase_line.product_id::text, coalesce(purchase_line.variant_id::text, '')
      ),
      '[]'::jsonb
    )
    into persisted_lines
    from public.purchase_order_lines purchase_line
    where purchase_line.organization_id = target_organization_id
      and purchase_line.purchase_order_id = existing_order.id;

    if existing_order.store_id = target_store_id
       and existing_order.supplier_id = target_supplier_id
       and existing_order.created_by_employee_id = actor_id
       and existing_order.expected_at is not distinct from target_expected_at
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
    organization_id,
    store_id,
    supplier_id,
    order_number,
    status,
    notes,
    expected_at,
    ordered_at,
    created_by_employee_id,
    operation_id
  )
  values (
    target_organization_id,
    target_store_id,
    target_supplier_id,
    next_number,
    'ordered',
    normalized_note,
    target_expected_at,
    now(),
    actor_id,
    target_operation_id
  )
  returning id into order_id;

  for line in select value from jsonb_array_elements(target_lines)
  loop
    select
      product.name as product_name,
      variant.name as variant_name
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
        select 1
        from public.product_store_settings store_setting
        where store_setting.organization_id = target_organization_id
          and store_setting.store_id = target_store_id
          and store_setting.product_id = product.id
          and store_setting.is_available
      );

    if not found then
      raise exception 'Every order item must be an active tracked item available in the receiving store.' using errcode = '23514';
    end if;

    select
      product_unit.unit_code,
      product_unit.unit_name,
      product_unit.factor_to_base
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
      organization_id,
      purchase_order_id,
      product_id,
      variant_id,
      product_name_snapshot,
      variant_name_snapshot,
      unit_snapshot,
      purchase_unit_code_snapshot,
      purchase_unit_factor_to_base,
      ordered_quantity,
      unit_cost_minor
    )
    values (
      target_organization_id,
      order_id,
      (line ->> 'product_id')::uuid,
      nullif(line ->> 'variant_id', '')::uuid,
      product_row.product_name,
      product_row.variant_name,
      purchase_unit_row.unit_name,
      purchase_unit_row.unit_code,
      purchase_unit_row.factor_to_base,
      (line ->> 'quantity')::numeric(14,3),
      (line ->> 'unit_cost_minor')::bigint
    );
  end loop;

  return order_id;
end;
$$;

create function public.create_purchase_order(
  target_organization_id uuid,
  target_store_id uuid,
  target_supplier_id uuid,
  target_notes text,
  target_expected_at date,
  target_lines jsonb,
  target_operation_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_purchase_order(
    target_organization_id,
    target_store_id,
    target_supplier_id,
    target_notes,
    target_expected_at,
    target_lines,
    target_operation_id
  );
$$;

create function private.receive_purchase_order(
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
     or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
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

create function public.receive_purchase_order(
  target_organization_id uuid,
  target_purchase_order_id uuid,
  target_lines jsonb,
  target_note text,
  target_operation_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.receive_purchase_order(
    target_organization_id,
    target_purchase_order_id,
    target_lines,
    target_note,
    target_operation_id
  );
$$;

create function private.cancel_purchase_order(
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
     or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
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

create function public.cancel_purchase_order(
  target_organization_id uuid,
  target_purchase_order_id uuid,
  target_note text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.cancel_purchase_order(
    target_organization_id,
    target_purchase_order_id,
    target_note
  );
$$;

revoke execute on function
  private.create_purchase_order(uuid, uuid, uuid, text, date, jsonb, uuid),
  private.receive_purchase_order(uuid, uuid, jsonb, text, uuid),
  private.cancel_purchase_order(uuid, uuid, text)
from public, anon, service_role;

grant execute on function
  private.create_purchase_order(uuid, uuid, uuid, text, date, jsonb, uuid),
  private.receive_purchase_order(uuid, uuid, jsonb, text, uuid),
  private.cancel_purchase_order(uuid, uuid, text)
to authenticated;

revoke execute on function
  public.create_purchase_order(uuid, uuid, uuid, text, date, jsonb, uuid),
  public.receive_purchase_order(uuid, uuid, jsonb, text, uuid),
  public.cancel_purchase_order(uuid, uuid, text)
from public, anon, service_role;

grant execute on function
  public.create_purchase_order(uuid, uuid, uuid, text, date, jsonb, uuid),
  public.receive_purchase_order(uuid, uuid, jsonb, text, uuid),
  public.cancel_purchase_order(uuid, uuid, text)
to authenticated;

commit;
