begin;

-- A receipt must remain independently explainable even if purchase-unit
-- configuration or the purchase order is inspected years later.
alter table public.goods_receipt_lines
  add column base_quantity_received numeric(14,3),
  add column purchase_unit_code_snapshot text,
  add column purchase_unit_factor_to_base numeric(14,3),
  add column purchase_unit_cost_minor bigint,
  add column stock_unit_cost_minor bigint;

update public.goods_receipt_lines receipt_line
set base_quantity_received = round(receipt_line.quantity_received * purchase_line.purchase_unit_factor_to_base, 3),
    purchase_unit_code_snapshot = purchase_line.purchase_unit_code_snapshot,
    purchase_unit_factor_to_base = purchase_line.purchase_unit_factor_to_base,
    purchase_unit_cost_minor = purchase_line.unit_cost_minor,
    stock_unit_cost_minor = round(purchase_line.unit_cost_minor::numeric / purchase_line.purchase_unit_factor_to_base)::bigint
from public.purchase_order_lines purchase_line
where purchase_line.id = receipt_line.purchase_order_line_id
  and purchase_line.organization_id = receipt_line.organization_id;

alter table public.goods_receipt_lines
  alter column base_quantity_received set not null,
  alter column purchase_unit_code_snapshot set not null,
  alter column purchase_unit_factor_to_base set not null,
  alter column purchase_unit_cost_minor set not null,
  alter column stock_unit_cost_minor set not null,
  add constraint goods_receipt_lines_base_quantity_positive
    check (base_quantity_received > 0 and base_quantity_received = round(base_quantity_received, 3)),
  add constraint goods_receipt_lines_purchase_factor_positive
    check (purchase_unit_factor_to_base > 0 and purchase_unit_factor_to_base = round(purchase_unit_factor_to_base, 3)),
  add constraint goods_receipt_lines_costs_nonnegative
    check (purchase_unit_cost_minor >= 0 and stock_unit_cost_minor >= 0);

create or replace function private.snapshot_goods_receipt_line_truth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  purchase_line public.purchase_order_lines%rowtype;
  converted_quantity numeric(14,6);
begin
  select line.*
  into purchase_line
  from public.purchase_order_lines line
  where line.id = new.purchase_order_line_id
    and line.organization_id = new.organization_id;

  if purchase_line.id is null then
    raise exception 'A receipt line must reference a purchase-order line in the same organization.' using errcode = '23514';
  end if;

  converted_quantity := new.quantity_received * purchase_line.purchase_unit_factor_to_base;
  if converted_quantity <> round(converted_quantity, 3) then
    raise exception 'This received quantity cannot be expressed in the product base unit to three decimal places.' using errcode = '23514';
  end if;

  new.base_quantity_received := round(converted_quantity, 3);
  new.purchase_unit_code_snapshot := purchase_line.purchase_unit_code_snapshot;
  new.purchase_unit_factor_to_base := purchase_line.purchase_unit_factor_to_base;
  new.purchase_unit_cost_minor := purchase_line.unit_cost_minor;
  new.stock_unit_cost_minor := round(purchase_line.unit_cost_minor::numeric / purchase_line.purchase_unit_factor_to_base)::bigint;
  return new;
end;
$$;

create trigger goods_receipt_lines_snapshot_truth
before insert on public.goods_receipt_lines
for each row execute function private.snapshot_goods_receipt_line_truth();

create or replace function private.guard_purchasing_evidence_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_status text;
begin
  if tg_table_name in ('goods_receipts', 'goods_receipt_lines') then
    raise exception 'Posted goods-receipt evidence is immutable.' using errcode = '23514';
  end if;

  if tg_table_name = 'purchase_orders' then
    if old.status in ('received', 'cancelled') then
      raise exception 'Terminal purchase orders are immutable.' using errcode = '23514';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select purchase_order.status
  into parent_status
  from public.purchase_orders purchase_order
  where purchase_order.id = old.purchase_order_id
    and purchase_order.organization_id = old.organization_id;

  if parent_status in ('received', 'cancelled') then
    raise exception 'Terminal purchase-order lines are immutable.' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger goods_receipts_guard_immutable
before update or delete on public.goods_receipts
for each row execute function private.guard_purchasing_evidence_immutability();
create trigger goods_receipt_lines_guard_immutable
before update or delete on public.goods_receipt_lines
for each row execute function private.guard_purchasing_evidence_immutability();
create trigger purchase_orders_guard_terminal
before update or delete on public.purchase_orders
for each row execute function private.guard_purchasing_evidence_immutability();
create trigger purchase_order_lines_guard_terminal
before update or delete on public.purchase_order_lines
for each row execute function private.guard_purchasing_evidence_immutability();

-- Public commands own operation serialization.  SECURITY DEFINER is deliberate:
-- private implementations retain their authorization checks, while application
-- roles no longer need direct EXECUTE on the private mutation functions.
create or replace function public.create_purchase_order_v2(
  target_organization_id uuid,
  target_store_id uuid,
  target_supplier_id uuid,
  target_notes text,
  target_lines jsonb,
  target_operation_id uuid,
  target_expected_at date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_id uuid;
  was_existing boolean;
  actor_id uuid;
begin
  if (select auth.uid()) is null
     or not (
       (select private.has_permission(target_organization_id, 'inventory.manage'))
       or (select private.has_inventory_capability(target_organization_id, 'purchasing.po.create'))
     )
     or not (select private.has_permission(target_organization_id, 'products.view_cost')) then
    raise exception 'Purchase-order creation and product-cost permission are required.' using errcode = '42501';
  end if;
  if target_operation_id is null then
    raise exception 'A stable purchase-order operation ID is required.' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_organization_id::text || ':purchase-order:' || target_operation_id::text, 0)
  );
  was_existing := exists (
    select 1 from public.purchase_orders purchase_order
    where purchase_order.organization_id = target_organization_id
      and purchase_order.operation_id = target_operation_id
  );

  order_id := private.create_purchase_order(
    target_organization_id, target_store_id, target_supplier_id, target_notes,
    target_expected_at, target_lines, target_operation_id
  );

  if not was_existing then
    actor_id := private.inventory_actor(target_organization_id, target_store_id);
    perform private.write_audit_log(
      target_organization_id, 'PURCHASE_ORDER_CREATED', 'purchasing.po.create', actor_id,
      null, target_store_id, null, null, null, nullif(btrim(target_notes), ''),
      jsonb_build_object('purchase_order_id', order_id, 'supplier_id', target_supplier_id,
        'operation_id', target_operation_id)
    );
  end if;
  return order_id;
end;
$$;

create or replace function public.receive_purchase_order(
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
begin
  if target_operation_id is null then
    raise exception 'A stable goods-receipt operation ID is required.' using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_organization_id::text || ':goods-receipt:' || target_operation_id::text, 0)
  );
  return private.receive_purchase_order(
    target_organization_id, target_purchase_order_id, target_lines, target_note, target_operation_id
  );
end;
$$;

create or replace function public.cancel_purchase_order(
  target_organization_id uuid,
  target_purchase_order_id uuid,
  target_note text default null
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.cancel_purchase_order(target_organization_id, target_purchase_order_id, target_note);
$$;

revoke execute on function private.create_purchase_order(uuid,uuid,uuid,text,date,jsonb,uuid)
from public, anon, authenticated, service_role;
revoke execute on function private.receive_purchase_order(uuid,uuid,jsonb,text,uuid)
from public, anon, authenticated, service_role;
revoke execute on function private.cancel_purchase_order(uuid,uuid,text)
from public, anon, authenticated, service_role;
revoke execute on function private.snapshot_goods_receipt_line_truth()
from public, anon, authenticated, service_role;
revoke execute on function private.guard_purchasing_evidence_immutability()
from public, anon, authenticated, service_role;

revoke all on function public.create_purchase_order_v2(uuid,uuid,uuid,text,jsonb,uuid,date)
from public, anon, service_role;
revoke all on function public.receive_purchase_order(uuid,uuid,jsonb,text,uuid)
from public, anon, service_role;
revoke all on function public.cancel_purchase_order(uuid,uuid,text)
from public, anon, service_role;
grant execute on function public.create_purchase_order_v2(uuid,uuid,uuid,text,jsonb,uuid,date) to authenticated;
grant execute on function public.receive_purchase_order(uuid,uuid,jsonb,text,uuid) to authenticated;
grant execute on function public.cancel_purchase_order(uuid,uuid,text) to authenticated;

comment on column public.goods_receipt_lines.base_quantity_received is
  'Immutable stock/base-unit quantity posted by this receipt line.';
comment on column public.goods_receipt_lines.purchase_unit_factor_to_base is
  'Immutable purchase-unit conversion factor used by this receipt.';
comment on column public.goods_receipt_lines.purchase_unit_cost_minor is
  'Immutable cost per received purchase unit from the purchase-order line.';
comment on column public.goods_receipt_lines.stock_unit_cost_minor is
  'Immutable rounded cost per stock/base unit supplied to the inventory ledger.';

commit;
