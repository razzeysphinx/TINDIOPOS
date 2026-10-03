begin;

create or replace function public.get_inventory_schema_contract(
  target_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  missing_core text[] := array[]::text[];
  modules jsonb;
begin
  if (select auth.uid()) is null then
    raise exception
      using errcode = '42501',
            message = 'Authentication required.';
  end if;

  if not exists (
    select 1
    from public.organizations organization
    join public.employees employee
      on employee.organization_id = organization.id
    where organization.id = target_organization_id
      and organization.status = 'active'
      and employee.profile_id = (select auth.uid())
      and employee.status = 'active'
  ) then
    raise exception
      using errcode = '42501',
            message = 'Organization access denied.';
  end if;

  if pg_catalog.to_regclass(
    'public.inventory_levels'
  ) is null then
    missing_core := array_append(
      missing_core,
      'inventory_levels'
    );
  end if;

  if pg_catalog.to_regclass(
    'public.inventory_movements'
  ) is null then
    missing_core := array_append(
      missing_core,
      'inventory_movements'
    );
  end if;

  if pg_catalog.to_regclass(
    'public.products'
  ) is null then
    missing_core := array_append(
      missing_core,
      'products'
    );
  end if;

  if pg_catalog.to_regclass(
    'public.product_variants'
  ) is null then
    missing_core := array_append(
      missing_core,
      'product_variants'
    );
  end if;

  if pg_catalog.to_regclass(
    'public.product_store_settings'
  ) is null then
    missing_core := array_append(
      missing_core,
      'product_store_settings'
    );
  end if;

  if pg_catalog.to_regclass(
    'public.stores'
  ) is null then
    missing_core := array_append(
      missing_core,
      'stores'
    );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'apply_inventory_change_v2'
  ) then
    missing_core := array_append(
      missing_core,
      'apply_inventory_change_v2'
    );
  end if;

  modules := jsonb_build_object(
    'count_batches',
      pg_catalog.to_regclass(
        'public.inventory_count_batches'
      ) is not null
      and pg_catalog.to_regclass(
        'public.inventory_count_batch_documents'
      ) is not null,

    'direct_transfers',
      pg_catalog.to_regclass(
        'public.stock_transfers'
      ) is not null
      and pg_catalog.to_regclass(
        'public.stock_transfer_lines'
      ) is not null
      and exists (
        select 1
        from pg_catalog.pg_proc procedure
        join pg_catalog.pg_namespace namespace
          on namespace.oid = procedure.pronamespace
        where namespace.nspname = 'public'
          and procedure.proname =
            'create_direct_stock_transfer'
      ),

    'purchasing',
      pg_catalog.to_regclass(
        'public.purchase_orders'
      ) is not null
      and pg_catalog.to_regclass(
        'public.purchase_order_lines'
      ) is not null
      and pg_catalog.to_regclass(
        'public.suppliers'
      ) is not null,

    'valuation',
      exists (
        select 1
        from pg_catalog.pg_proc procedure
        join pg_catalog.pg_namespace namespace
          on namespace.oid = procedure.pronamespace
        where namespace.nspname = 'public'
          and procedure.proname =
            'get_inventory_valuation'
      ),

    'replenishment',
      pg_catalog.to_regclass(
        'public.inventory_replenishment_rules'
      ) is not null
  );

  return jsonb_build_object(
    'contract_version', 1,
    'core_ready', cardinality(missing_core) = 0,
    'core_missing', to_jsonb(missing_core),
    'modules', modules
  );
end;
$$;

revoke all
on function public.get_inventory_schema_contract(uuid)
from public;

revoke all
on function public.get_inventory_schema_contract(uuid)
from anon;

grant execute
on function public.get_inventory_schema_contract(uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
