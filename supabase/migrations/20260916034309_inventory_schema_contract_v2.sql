begin;

create or replace function public.get_inventory_schema_contract(
  target_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  missing_core text[] := array[]::text[];
  modules jsonb;
  required_function text;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if not exists (
    select 1
    from public.organizations organization
    join public.employees employee on employee.organization_id = organization.id
    where organization.id = target_organization_id
      and organization.status = 'active'
      and employee.profile_id = (select auth.uid())
      and employee.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Organization access denied.';
  end if;

  if pg_catalog.to_regclass('public.inventory_levels') is null then
    missing_core := array_append(missing_core, 'inventory_levels');
  end if;
  if pg_catalog.to_regclass('public.inventory_movements') is null then
    missing_core := array_append(missing_core, 'inventory_movements');
  end if;
  if pg_catalog.to_regclass('public.products') is null then
    missing_core := array_append(missing_core, 'products');
  end if;
  if pg_catalog.to_regclass('public.product_variants') is null then
    missing_core := array_append(missing_core, 'product_variants');
  end if;
  if pg_catalog.to_regclass('public.product_store_settings') is null then
    missing_core := array_append(missing_core, 'product_store_settings');
  end if;
  if pg_catalog.to_regclass('public.stores') is null then
    missing_core := array_append(missing_core, 'stores');
  end if;

  foreach required_function in array array[
    'private.apply_inventory_change_v2(uuid,uuid,uuid,uuid,numeric,text,uuid,text,text,uuid,bigint,text)',
    'public.create_inventory_count_plan_v2(uuid,uuid,text,text,text,jsonb,text,boolean,uuid)',
    'public.save_inventory_count_line_v2(uuid,uuid,uuid,numeric,uuid)',
    'public.post_inventory_count(uuid,uuid,uuid)',
    'public.create_purchase_order_v2(uuid,uuid,uuid,text,jsonb,uuid,date)',
    'public.record_inventory_adjustment_v3(uuid,uuid,uuid,numeric,text,text,uuid,uuid,uuid)'
  ] loop
    if pg_catalog.to_regprocedure(required_function) is null then
      missing_core := array_append(missing_core, required_function);
    end if;
  end loop;

  if pg_catalog.to_regprocedure('public.complete_inventory_count(uuid,uuid,text,jsonb)') is not null then
    missing_core := array_append(missing_core, 'legacy_complete_inventory_count');
  end if;
  if pg_catalog.to_regprocedure('public.post_inventory_count(uuid,uuid)') is not null then
    missing_core := array_append(missing_core, 'legacy_post_inventory_count');
  end if;

  modules := jsonb_build_object(
    'count_batches', pg_catalog.to_regclass('public.inventory_count_batches') is not null and pg_catalog.to_regclass('public.inventory_count_batch_documents') is not null,
    'direct_transfers', pg_catalog.to_regclass('public.stock_transfers') is not null and pg_catalog.to_regclass('public.stock_transfer_lines') is not null and exists (
      select 1
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'create_direct_stock_transfer'
    ),
    'purchasing', pg_catalog.to_regclass('public.purchase_orders') is not null and pg_catalog.to_regclass('public.purchase_order_lines') is not null and pg_catalog.to_regclass('public.suppliers') is not null,
    'valuation', pg_catalog.to_regprocedure('public.get_inventory_valuation(uuid)') is not null,
    'replenishment', pg_catalog.to_regclass('public.inventory_replenishment_rules') is not null
  );

  return jsonb_build_object(
    'contract_version', 2,
    'core_ready', cardinality(missing_core) = 0,
    'core_missing', to_jsonb(missing_core),
    'modules', modules
  );
end;
$function$;

revoke all on function public.get_inventory_schema_contract(uuid) from public, anon, service_role;
grant execute on function public.get_inventory_schema_contract(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
