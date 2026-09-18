begin;

create extension if not exists pgtap with schema extensions;
select plan(30);

select has_column('public', 'goods_receipt_lines', 'base_quantity_received', 'receipt evidence snapshots the posted base quantity');
select has_column('public', 'goods_receipt_lines', 'purchase_unit_code_snapshot', 'receipt evidence snapshots the purchase unit');
select has_column('public', 'goods_receipt_lines', 'purchase_unit_factor_to_base', 'receipt evidence snapshots unit conversion');
select has_column('public', 'goods_receipt_lines', 'purchase_unit_cost_minor', 'receipt evidence snapshots purchase-unit cost');
select has_column('public', 'goods_receipt_lines', 'stock_unit_cost_minor', 'receipt evidence snapshots stock-unit cost');
select col_not_null('public', 'goods_receipt_lines', 'base_quantity_received', 'posted base quantity cannot be omitted');
select col_not_null('public', 'goods_receipt_lines', 'purchase_unit_factor_to_base', 'posted conversion cannot be omitted');
select col_not_null('public', 'goods_receipt_lines', 'purchase_unit_cost_minor', 'posted purchase cost cannot be omitted');
select col_not_null('public', 'goods_receipt_lines', 'stock_unit_cost_minor', 'posted stock cost cannot be omitted');

select has_trigger('public', 'goods_receipt_lines', 'goods_receipt_lines_snapshot_truth', 'receipt insertion captures immutable unit and cost truth');
select has_trigger('public', 'goods_receipts', 'goods_receipts_guard_immutable', 'receipt headers are immutable');
select has_trigger('public', 'goods_receipt_lines', 'goods_receipt_lines_guard_immutable', 'receipt lines are immutable');
select has_trigger('public', 'purchase_orders', 'purchase_orders_guard_terminal', 'terminal purchase orders are immutable');
select has_trigger('public', 'purchase_order_lines', 'purchase_order_lines_guard_terminal', 'terminal purchase-order lines are immutable');
select ok(pg_get_functiondef('private.snapshot_goods_receipt_line_truth()'::regprocedure) like '%quantity_received * purchase_line.purchase_unit_factor_to_base%', 'receipt stock quantity uses the locked PO conversion');
select ok(pg_get_functiondef('private.snapshot_goods_receipt_line_truth()'::regprocedure) like '%unit_cost_minor::numeric / purchase_line.purchase_unit_factor_to_base%', 'receipt stock cost uses the same locked conversion');

select ok(pg_get_functiondef('public.create_purchase_order_v2(uuid,uuid,uuid,text,jsonb,uuid,date)'::regprocedure) like '%pg_advisory_xact_lock%', 'PO creation serializes exact operation retries');
select ok(pg_get_functiondef('public.receive_purchase_order(uuid,uuid,jsonb,text,uuid)'::regprocedure) like '%pg_advisory_xact_lock%', 'receiving serializes exact operation retries');
select ok(pg_get_functiondef('public.create_purchase_order_v2(uuid,uuid,uuid,text,jsonb,uuid,date)'::regprocedure) like '%products.view_cost%', 'database PO creation enforces cost visibility');
select ok(pg_get_functiondef('public.create_purchase_order_v2(uuid,uuid,uuid,text,jsonb,uuid,date)'::regprocedure) like '%PURCHASE_ORDER_CREATED%', 'PO creation writes audit evidence once');
select ok(pg_get_functiondef('private.receive_purchase_order(uuid,uuid,jsonb,text,uuid)'::regprocedure) like '%Received quantity cannot exceed the ordered quantity.%', 'canonical receipt rejects over-receipt');
select ok(pg_get_functiondef('private.receive_purchase_order(uuid,uuid,jsonb,text,uuid)'::regprocedure) like '%private.apply_inventory_change_v2%', 'canonical receipt owns purchase stock mutation');
select ok(pg_get_functiondef('private.receive_purchase_order(uuid,uuid,jsonb,text,uuid)'::regprocedure) like $$%'RECEIPT'%$$, 'canonical receipt records RECEIPT movements');
select ok(pg_get_functiondef('private.cancel_purchase_order(uuid,uuid,text)'::regprocedure) not like '%apply_inventory_change%', 'PO cancellation stays stock-neutral');

select ok(not has_function_privilege('authenticated', 'private.create_purchase_order(uuid,uuid,uuid,text,date,jsonb,uuid)', 'execute'), 'application roles cannot bypass canonical PO create');
select ok(not has_function_privilege('authenticated', 'private.receive_purchase_order(uuid,uuid,jsonb,text,uuid)', 'execute'), 'application roles cannot bypass canonical receipt serialization');
select ok(not has_function_privilege('authenticated', 'private.cancel_purchase_order(uuid,uuid,text)', 'execute'), 'application roles cannot bypass canonical cancellation');
select ok(has_function_privilege('authenticated', 'public.create_purchase_order_v2(uuid,uuid,uuid,text,jsonb,uuid,date)', 'execute'), 'authenticated callers can create canonical POs');
select ok(has_function_privilege('authenticated', 'public.receive_purchase_order(uuid,uuid,jsonb,text,uuid)', 'execute'), 'authenticated callers can use canonical receiving');
select ok(to_regprocedure('public.create_purchase_order(uuid,uuid,uuid,text,date,jsonb,uuid)') is null, 'superseded public PO create signature is absent');

select * from finish();
rollback;
