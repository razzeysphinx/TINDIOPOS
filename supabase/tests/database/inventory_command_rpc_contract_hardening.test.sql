begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

select has_function('public', 'create_inventory_count_plan_v2', array['uuid', 'uuid', 'text', 'text', 'text', 'jsonb', 'text', 'boolean', 'uuid'], 'count-plan v2 exists with the public optional scope contract');
select has_function('public', 'save_inventory_count_line_v2', array['uuid', 'uuid', 'uuid', 'numeric', 'uuid'], 'count-line v2 exists with the public optional variant contract');
select has_function('public', 'create_purchase_order_v2', array['uuid', 'uuid', 'uuid', 'text', 'jsonb', 'uuid', 'date'], 'purchase-order v2 exists with the public optional expected-date contract');
select has_function('public', 'record_inventory_adjustment_v3', array['uuid', 'uuid', 'uuid', 'numeric', 'text', 'text', 'uuid', 'uuid', 'uuid'], 'adjustment v3 exists with the public optional approval and variant contract');
select has_function('public', 'post_inventory_count', array['uuid', 'uuid', 'uuid'], 'the idempotent public count-post contract exists');
select has_function('public', 'upsert_inventory_replenishment_rule_v2', array['uuid', 'uuid', 'uuid', 'numeric', 'numeric', 'uuid', 'uuid'], 'replenishment-rule v2 exposes optional UUIDs as trailing defaults');

select ok(to_regprocedure('public.save_inventory_count_line(uuid,uuid,uuid,uuid,numeric)') is null, 'the old count-line public contract is retired');
select ok(to_regprocedure('public.create_inventory_count_plan(uuid,uuid,text,text,text,uuid,jsonb,text,boolean)') is null, 'the old count-plan public contract is retired');
select ok(to_regprocedure('public.create_inventory_count_draft(uuid,uuid,text)') is null, 'the old count-draft public contract is retired');
select ok(to_regprocedure('public.complete_inventory_count(uuid,uuid,text,jsonb)') is null, 'the legacy one-step public count contract is retired');
select ok(to_regprocedure('public.post_inventory_count(uuid,uuid)') is null, 'the non-idempotent public count-post contract is retired');
select ok(to_regprocedure('public.create_purchase_order(uuid,uuid,uuid,text,date,jsonb,uuid)') is null, 'the old purchase-order public contract is retired');
select ok(to_regprocedure('public.record_inventory_adjustment(uuid,uuid,uuid,uuid,numeric,text,text,uuid,uuid)') is null, 'the old controlled-adjustment public contract is retired');
select ok(to_regprocedure('public.upsert_inventory_replenishment_rule(uuid,uuid,uuid,uuid,uuid,numeric,numeric)') is null, 'the legacy replenishment-rule public contract is retired');

select ok(has_function_privilege('authenticated', 'public.create_inventory_count_plan_v2(uuid,uuid,text,text,text,jsonb,text,boolean,uuid)', 'execute'), 'authenticated can prepare counts through v2');
select ok(has_function_privilege('authenticated', 'public.save_inventory_count_line_v2(uuid,uuid,uuid,numeric,uuid)', 'execute'), 'authenticated can save count lines through v2');
select ok(has_function_privilege('authenticated', 'public.create_purchase_order_v2(uuid,uuid,uuid,text,jsonb,uuid,date)', 'execute'), 'authenticated can create purchase orders through v2');
select ok(has_function_privilege('authenticated', 'public.record_inventory_adjustment_v3(uuid,uuid,uuid,numeric,text,text,uuid,uuid,uuid)', 'execute'), 'authenticated can adjust inventory through v3');
select ok(not has_function_privilege('anon', 'public.create_inventory_count_plan_v2(uuid,uuid,text,text,text,jsonb,text,boolean,uuid)', 'execute'), 'anon cannot prepare counts');
select ok(not has_function_privilege('anon', 'public.save_inventory_count_line_v2(uuid,uuid,uuid,numeric,uuid)', 'execute'), 'anon cannot save count lines');
select ok(not has_function_privilege('anon', 'public.create_purchase_order_v2(uuid,uuid,uuid,text,jsonb,uuid,date)', 'execute'), 'anon cannot create purchase orders');
select ok(not has_function_privilege('anon', 'public.record_inventory_adjustment_v3(uuid,uuid,uuid,numeric,text,text,uuid,uuid,uuid)', 'execute'), 'anon cannot adjust inventory');

select ok(pg_get_function_arguments('public.create_inventory_count_plan_v2(uuid,uuid,text,text,text,jsonb,text,boolean,uuid)'::regprocedure) like '%target_scope_reference_id uuid DEFAULT NULL%', 'scope reference has an explicit trailing default');
select ok(pg_get_function_arguments('public.save_inventory_count_line_v2(uuid,uuid,uuid,numeric,uuid)'::regprocedure) like '%target_variant_id uuid DEFAULT NULL%', 'count-line variant has an explicit trailing default');
select ok(pg_get_function_arguments('public.create_purchase_order_v2(uuid,uuid,uuid,text,jsonb,uuid,date)'::regprocedure) like '%target_expected_at date DEFAULT NULL%', 'purchase expected date has an explicit trailing default');
select ok(pg_get_function_arguments('public.record_inventory_adjustment_v3(uuid,uuid,uuid,numeric,text,text,uuid,uuid,uuid)'::regprocedure) like '%target_approval_request_id uuid DEFAULT NULL%', 'adjustment approval has an explicit default');
select ok(pg_get_function_arguments('public.record_inventory_adjustment_v3(uuid,uuid,uuid,numeric,text,text,uuid,uuid,uuid)'::regprocedure) like '%target_variant_id uuid DEFAULT NULL%', 'adjustment variant has an explicit trailing default');

select * from finish();
rollback;
