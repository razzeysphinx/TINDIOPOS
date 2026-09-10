-- Rollback-safe Phase 2 verification. It exercises the public RPC boundary
-- with a real owner/employee context; no test organization or stock remains.

begin;
create extension if not exists pgtap with schema extensions;
select plan(1);

do $body$
declare
  profile_id uuid := gen_random_uuid();
  test_organization_id uuid;
  test_store_id uuid;
  test_unavailable_store_id uuid;
  test_product_id uuid;
  test_supplier_id uuid;
  test_purchase_order_id uuid;
  test_purchase_order_line_id uuid;
  test_cancelled_order_id uuid;
  test_receipt_id uuid;
  test_repeated_receipt_id uuid;
  purchase_operation_id uuid := gen_random_uuid();
  receipt_operation_id uuid := gen_random_uuid();
  cancel_operation_id uuid := gen_random_uuid();
  movement_count_before integer;
  movement_count_after integer;
  denied boolean := false;
  mismatched_replay_rejected boolean := false;
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data)
    values (
      profile_id,
      format('phase-2-%s@tindio.test', replace(profile_id::text, '-', '')),
      jsonb_build_object('full_name', 'Phase 2 Purchasing Owner')
    );

    perform set_config('request.jwt.claim.sub', profile_id::text, true);

    select bootstrap.organization_id, bootstrap.store_id
    into test_organization_id, test_store_id
    from public.bootstrap_organization(
      format('Phase 2 Purchasing %s', left(profile_id::text, 8)),
      'Receiving Store',
      'Receiving Register'
    ) bootstrap;

    test_product_id := public.create_catalog_product(
      test_organization_id,
      null,
      'Phase 2 Receiving Item',
      'Purchase-order receiving integrity test item',
      'simple',
      'PHASE2-ITEM',
      '480000090020',
      2500,
      1000,
      true,
      'each',
      array[test_store_id],
      '[]'::jsonb
    );
    test_supplier_id := public.create_supplier(test_organization_id, 'Phase 2 Supplier', '', '', '', '', '');

    test_purchase_order_id := public.create_purchase_order(
      test_organization_id,
      test_store_id,
      test_supplier_id,
      'Expected 10 each',
      null,
      jsonb_build_array(jsonb_build_object(
        'product_id', test_product_id,
        'variant_id', null,
        'purchase_unit_code', 'each',
        'quantity', '10',
        'unit_cost_minor', 1000
      )),
      purchase_operation_id
    );

    if public.create_purchase_order(
      test_organization_id,
      test_store_id,
      test_supplier_id,
      'Expected 10 each',
      null,
      jsonb_build_array(jsonb_build_object(
        'product_id', test_product_id,
        'variant_id', null,
        'purchase_unit_code', 'each',
        'quantity', '10',
        'unit_cost_minor', 1000
      )),
      purchase_operation_id
    ) <> test_purchase_order_id then
      raise exception 'Purchase-order retry did not return the original document.';
    end if;

    if (select level.quantity from public.inventory_levels level where level.organization_id = test_organization_id and level.store_id = test_store_id and level.product_id = test_product_id) <> 0 then
      raise exception 'Creating a purchase order changed on-hand inventory.';
    end if;

    select purchase_line.id into test_purchase_order_line_id
    from public.purchase_order_lines purchase_line
    where purchase_line.purchase_order_id = test_purchase_order_id;

    if (select purchase_line.ordered_quantity - purchase_line.received_quantity from public.purchase_order_lines purchase_line where purchase_line.id = test_purchase_order_line_id) <> 10 then
      raise exception 'Incoming quantity is not represented by the open purchase-order line.';
    end if;

    select count(*) into movement_count_before
    from public.inventory_movements movement
    where movement.organization_id = test_organization_id
      and movement.source_type = 'goods_receipt';

    test_receipt_id := public.receive_purchase_order(
      test_organization_id,
      test_purchase_order_id,
      jsonb_build_array(jsonb_build_object('purchase_order_line_id', test_purchase_order_line_id, 'quantity', '3')),
      'First partial delivery',
      receipt_operation_id
    );

    test_repeated_receipt_id := public.receive_purchase_order(
      test_organization_id,
      test_purchase_order_id,
      jsonb_build_array(jsonb_build_object('purchase_order_line_id', test_purchase_order_line_id, 'quantity', '3')),
      'First partial delivery',
      receipt_operation_id
    );

    if test_repeated_receipt_id <> test_receipt_id
       or (select level.quantity from public.inventory_levels level where level.organization_id = test_organization_id and level.store_id = test_store_id and level.product_id = test_product_id) <> 3
       or (select purchase_order.status from public.purchase_orders purchase_order where purchase_order.id = test_purchase_order_id) <> 'partially_received'
       or (select purchase_line.ordered_quantity - purchase_line.received_quantity from public.purchase_order_lines purchase_line where purchase_line.id = test_purchase_order_line_id) <> 7
       or not exists (select 1 from public.goods_receipts receipt where receipt.id = test_receipt_id and receipt.receipt_number > 0) then
      raise exception 'Partial receiving or its idempotent replay is incorrect.';
    end if;

    begin
      perform public.receive_purchase_order(
        test_organization_id,
        test_purchase_order_id,
        jsonb_build_array(jsonb_build_object('purchase_order_line_id', test_purchase_order_line_id, 'quantity', '2')),
        'Different payload',
        receipt_operation_id
      );
    exception
      when unique_violation then mismatched_replay_rejected := true;
    end;

    if not mismatched_replay_rejected then
      raise exception 'A receipt operation ID was reused for a different payload.';
    end if;

    perform public.receive_purchase_order(
      test_organization_id,
      test_purchase_order_id,
      jsonb_build_array(jsonb_build_object('purchase_order_line_id', test_purchase_order_line_id, 'quantity', '7')),
      'Final delivery',
      gen_random_uuid()
    );

    select count(*) into movement_count_after
    from public.inventory_movements movement
    where movement.organization_id = test_organization_id
      and movement.source_type = 'goods_receipt';

    if (select level.quantity from public.inventory_levels level where level.organization_id = test_organization_id and level.store_id = test_store_id and level.product_id = test_product_id) <> 10
       or (select purchase_order.status from public.purchase_orders purchase_order where purchase_order.id = test_purchase_order_id) <> 'received'
       or movement_count_after <> movement_count_before + 2 then
      raise exception 'Full receiving did not post exactly two canonical receipt movements.';
    end if;

    test_cancelled_order_id := public.create_purchase_order(
      test_organization_id,
      test_store_id,
      test_supplier_id,
      'Cancelled before delivery',
      null,
      jsonb_build_array(jsonb_build_object(
        'product_id', test_product_id,
        'variant_id', null,
        'purchase_unit_code', 'each',
        'quantity', '4',
        'unit_cost_minor', 1000
      )),
      cancel_operation_id
    );
    perform public.cancel_purchase_order(test_organization_id, test_cancelled_order_id, 'Supplier cancelled the delivery');

    if (select purchase_order.status from public.purchase_orders purchase_order where purchase_order.id = test_cancelled_order_id) <> 'cancelled'
       or (select level.quantity from public.inventory_levels level where level.organization_id = test_organization_id and level.store_id = test_store_id and level.product_id = test_product_id) <> 10 then
      raise exception 'Cancelling a purchase order changed stock or retained a receivable status.';
    end if;

    insert into public.stores (organization_id, name, code)
    values (test_organization_id, 'Unavailable Product Store', 'PHASE2-ALT')
    returning id into test_unavailable_store_id;

    begin
      perform public.create_purchase_order(
        test_organization_id,
        test_unavailable_store_id,
        test_supplier_id,
        'Invalid unavailable-item order',
        null,
        jsonb_build_array(jsonb_build_object(
          'product_id', test_product_id,
          'variant_id', null,
          'purchase_unit_code', 'each',
          'quantity', '1',
          'unit_cost_minor', 1000
        )),
        gen_random_uuid()
      );
    exception
      when check_violation then denied := true;
    end;

    if not denied then
      raise exception 'Receiving-store product availability was not enforced.';
    end if;

    perform set_config('request.jwt.claim.sub', '', true);
    denied := false;
    begin
      perform public.create_purchase_order(
        test_organization_id,
        test_store_id,
        test_supplier_id,
        'Unauthorized order',
        null,
        jsonb_build_array(jsonb_build_object(
          'product_id', test_product_id,
          'variant_id', null,
          'purchase_unit_code', 'each',
          'quantity', '1',
          'unit_cost_minor', 1000
        )),
        gen_random_uuid()
      );
    exception
      when insufficient_privilege then denied := true;
    end;

    if not denied then
      raise exception 'Unauthenticated purchase-order creation was not denied.';
    end if;

    raise exception 'ROLLBACK_PHASE_2_PURCHASING_TEST';
  exception
    when raise_exception then
      if sqlerrm <> 'ROLLBACK_PHASE_2_PURCHASING_TEST' then
        raise;
      end if;
  end;
end;
$body$;

select pass('purchase-order receiving integrity verification completed');
select * from finish();
rollback;
