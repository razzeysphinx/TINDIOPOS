-- Phase 10: retain the canonical purchasing procedures while adding their
-- explicit granular capability alternative to the legacy authorization path.
begin;

do $$
declare
  target record;
  current_definition text;
  updated_definition text;
  compact_legacy_guard text :=
    'not (select private.has_permission(target_organization_id,''inventory.manage''))';
  spaced_legacy_guard text :=
    'not (select private.has_permission(target_organization_id, ''inventory.manage''))';
begin
  for target in
    select *
    from (
      values
        ('private.create_supplier(uuid,text,text,text,text,text,text)'::regprocedure, 'purchasing.suppliers.manage'),
        ('public.update_supplier(uuid,uuid,text,text,text,text,text,text,boolean)'::regprocedure, 'purchasing.suppliers.manage'),
        ('private.import_suppliers_csv(uuid,jsonb)'::regprocedure, 'purchasing.suppliers.manage'),
        ('private.create_purchase_order(uuid,uuid,uuid,text,date,jsonb,uuid)'::regprocedure, 'purchasing.po.create'),
        ('private.cancel_purchase_order(uuid,uuid,text)'::regprocedure, 'purchasing.po.create'),
        ('private.receive_purchase_order(uuid,uuid,jsonb,text,uuid)'::regprocedure, 'purchasing.receive'),
        ('private.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)'::regprocedure, 'purchasing.return')
    ) as mappings(function_signature, required_capability)
  loop
    select pg_get_functiondef(target.function_signature)
    into current_definition;
    updated_definition := replace(
      replace(
        current_definition,
        compact_legacy_guard,
        format('(not (select private.has_permission(target_organization_id,''inventory.manage'')) and not (select private.has_inventory_capability(target_organization_id, %L)))', target.required_capability)
      ),
      spaced_legacy_guard,
      format('(not (select private.has_permission(target_organization_id, ''inventory.manage'')) and not (select private.has_inventory_capability(target_organization_id, %L)))', target.required_capability)
    );
    if updated_definition = current_definition then
      raise exception 'Canonical purchasing procedure % does not contain the expected inventory authorization guard.', target.function_signature
        using errcode = 'XX000';
    end if;
    execute updated_definition;
  end loop;
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
