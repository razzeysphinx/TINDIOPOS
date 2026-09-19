begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

select has_table('public','inventory_replenishment_rules','canonical replenishment table exists');
select ok(to_regprocedure('public.upsert_inventory_replenishment_rule_v2(uuid,uuid,uuid,numeric,numeric,uuid,uuid)') is not null,'canonical upsert exists');
select ok(to_regprocedure('public.set_catalog_product_store_configuration_v3(uuid,uuid,uuid,bigint,text)') is not null,'catalog configuration v3 exists');
select ok(to_regprocedure('public.import_catalog_products_v3(uuid,uuid[],jsonb)') is not null,'catalog import v3 exists');
select ok(to_regprocedure('public.set_catalog_product_store_configuration_v2(uuid,uuid,uuid,bigint,numeric,text)') is null,'catalog configuration v2 retired');
select ok(to_regprocedure('public.set_catalog_product_store_configuration(uuid,uuid,uuid,bigint,numeric)') is null,'catalog configuration legacy retired');
select ok(to_regprocedure('public.import_catalog_products_v2(uuid,uuid[],jsonb)') is null,'catalog import v2 retired');
select ok(not has_function_privilege('authenticated','private.upsert_inventory_replenishment_rule(uuid,uuid,uuid,uuid,uuid,numeric,numeric)','execute'),'private rule engine is not application executable');
select ok(not has_column_privilege('authenticated','public.product_store_settings','low_stock_level','insert'),'legacy threshold insert grant revoked');
select ok(not has_column_privilege('authenticated','public.product_store_settings','low_stock_level','update'),'legacy threshold update grant revoked');

insert into auth.users(id,email,raw_user_meta_data) values ('13131313-1313-4313-8313-131313131313','phase13-owner@tindio.test','{"full_name":"Phase 13 Owner"}'::jsonb);
create temporary table phase13_context(organization_id uuid,store_id uuid,register_id uuid,product_id uuid);
grant select,insert,update on phase13_context to authenticated;
set local role authenticated;
set local request.jwt.claim.sub='13131313-1313-4313-8313-131313131313';
insert into phase13_context(organization_id,store_id,register_id)
select organization_id,store_id,register_id from public.bootstrap_organization('Phase 13','Settings Store','Register');
update phase13_context set product_id=public.create_catalog_product_v3(organization_id,null,'Settings Item','Canonical settings','simple','P13-ITEM','480000013001',1000,500,true,'each',array[store_id],'[]'::jsonb,'',false,false,'made_to_order');

select throws_ok(format($$select public.upsert_inventory_replenishment_rule_v2(%L,%L,%L,-1,5,null,null)$$,(select organization_id from phase13_context),(select store_id from phase13_context),(select product_id from phase13_context)),'23514',null,'negative reorder point rejected');
select throws_ok(format($$select public.upsert_inventory_replenishment_rule_v2(%L,%L,%L,1,0,null,null)$$,(select organization_id from phase13_context),(select store_id from phase13_context),(select product_id from phase13_context)),'23514',null,'nonpositive target rejected');
select throws_ok(format($$select public.upsert_inventory_replenishment_rule_v2(%L,%L,%L,5,4,null,null)$$,(select organization_id from phase13_context),(select store_id from phase13_context),(select product_id from phase13_context)),'23514',null,'target below reorder rejected');
select throws_ok(format($$select public.upsert_inventory_replenishment_rule_v2(%L,%L,%L,1.0001,5,null,null)$$,(select organization_id from phase13_context),(select store_id from phase13_context),(select product_id from phase13_context)),'23514',null,'reorder precision enforced');
select throws_ok(format($$select public.upsert_inventory_replenishment_rule_v2(%L,%L,%L,1,5.0001,null,null)$$,(select organization_id from phase13_context),(select store_id from phase13_context),(select product_id from phase13_context)),'23514',null,'target precision enforced');
select lives_ok(format($$select public.upsert_inventory_replenishment_rule_v2(%L,%L,%L,2,8,null,null)$$,(select organization_id from phase13_context),(select store_id from phase13_context),(select product_id from phase13_context)),'valid canonical rule saved');
select is((select count(*) from public.inventory_replenishment_rules),1::bigint,'one rule per stock position');
select is((select reorder_point from public.inventory_replenishment_rules),2::numeric,'canonical reorder point stored');
select is((select target_stock from public.inventory_replenishment_rules),8::numeric,'canonical target stock stored');
select is((select count(*) from public.inventory_movements),0::bigint,'rule save creates no stock movement');
select is((select quantity from public.inventory_levels where product_id=(select product_id from phase13_context) and store_id=(select store_id from phase13_context)),0::numeric,'rule save does not mutate stock');
select ok(exists(select 1 from public.audit_logs where event_type='INVENTORY_REPLENISHMENT_RULE_SAVED'),'rule update audit exists');
select lives_ok(format($$select public.set_catalog_product_store_configuration_v3(%L,%L,%L,1250,'do_not_restock')$$,(select organization_id from phase13_context),(select product_id from phase13_context),(select store_id from phase13_context)),'catalog v3 updates non-threshold settings');
select is((select price_override_minor from public.product_store_settings where product_id=(select product_id from phase13_context)),1250::bigint,'price override preserved');
select is((select restock_policy from public.product_store_settings where product_id=(select product_id from phase13_context)),'do_not_restock','restock policy preserved');
select ok(exists(select 1 from public.audit_logs where event_type='PRODUCT_STORE_CONFIGURATION_UPDATED'),'store configuration audit exists');

reset role;
alter table public.product_store_settings disable trigger product_store_settings_guard_legacy_low_stock_level;
update public.product_store_settings set low_stock_level=3 where product_id=(select product_id from phase13_context);
alter table public.product_store_settings enable trigger product_store_settings_guard_legacy_low_stock_level;
set local role authenticated;
set local request.jwt.claim.sub='13131313-1313-4313-8313-131313131313';
select is((select low_stock_level from public.product_store_settings where product_id=(select product_id from phase13_context)),3::numeric,'historical legacy threshold survives');
select throws_ok(format($$update public.product_store_settings set low_stock_level=4 where product_id=%L$$,(select product_id from phase13_context)),'42501',null,'new direct legacy threshold update rejected');
select is((select coalesce(r.reorder_point,s.low_stock_level) from public.product_store_settings s left join public.inventory_replenishment_rules r on r.organization_id=s.organization_id and r.store_id=s.store_id and r.product_id=s.product_id and r.variant_id is null where s.product_id=(select product_id from phase13_context)),2::numeric,'effective threshold prefers canonical rule');
reset role;
delete from public.inventory_replenishment_rules where product_id=(select product_id from phase13_context);
select ok((select coalesce(r.reorder_point,s.low_stock_level)=3 and r.target_stock is null from public.product_store_settings s left join public.inventory_replenishment_rules r on r.organization_id=s.organization_id and r.store_id=s.store_id and r.product_id=s.product_id and r.variant_id is null where s.product_id=(select product_id from phase13_context)),'legacy fallback supplies a threshold but never target stock');

select * from finish();
rollback;
