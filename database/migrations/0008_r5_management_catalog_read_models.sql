begin;

create or replace function public.get_management_workspace_bundle_v1(
  target_organization_id uuid,
  requested_needs text[] default array[]::text[]
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $function$
  select jsonb_build_object(
    'stores', case when 'stores' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.created_at) from (select id, name, code, address, phone, is_active, created_at from public.stores where organization_id = target_organization_id) row_data), '[]'::jsonb) else '[]'::jsonb end,
    'registers', case when 'registers' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.created_at) from (select id, store_id, name, code, is_active, created_at from public.registers where organization_id = target_organization_id) row_data), '[]'::jsonb) else '[]'::jsonb end,
    'shifts', case when 'shifts' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.opened_at desc nulls last, row_data.id desc) from (select id, store_id, register_id, status, opened_at from public.shifts where organization_id = target_organization_id) row_data), '[]'::jsonb) else '[]'::jsonb end,
    'posDevices', case when 'posDevices' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.last_seen_at desc nulls last) from (select id, store_id, register_id, name, app_version, last_seen_at, status from public.pos_devices where organization_id = target_organization_id) row_data), '[]'::jsonb) else '[]'::jsonb end,
    'offlineSyncEvents', case when 'offlineSyncEvents' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data)) from (select id, store_id, register_id, state from public.offline_sync_events where organization_id = target_organization_id) row_data), '[]'::jsonb) else '[]'::jsonb end,
    'roles', case when 'roles' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.created_at) from (select id, name, code, description, is_system, created_at from public.roles where organization_id = target_organization_id) row_data), '[]'::jsonb) else '[]'::jsonb end,
    'rolePermissions', case when 'rolePermissions' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data)) from (select role_id, permission_code from public.role_permissions where organization_id = target_organization_id) row_data), '[]'::jsonb) else '[]'::jsonb end,
    'permissions', case when 'permissions' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.category, row_data.name) from (select code, name, category from public.permissions) row_data), '[]'::jsonb) else '[]'::jsonb end,
    'employees', case when 'employees' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.created_at) from (select id, profile_id, employee_number, job_title, status, created_at from public.employees where organization_id = target_organization_id) row_data), '[]'::jsonb) else '[]'::jsonb end,
    'profiles', case when 'profiles' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data)) from (select profile.id, profile.full_name, profile.email from public.profiles profile join public.employees employee on employee.profile_id = profile.id where employee.organization_id = target_organization_id) row_data), '[]'::jsonb) else '[]'::jsonb end,
    'employeeRoles', case when 'employeeRoles' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data)) from (select employee_id, role_id from public.employee_roles where organization_id = target_organization_id) row_data), '[]'::jsonb) else '[]'::jsonb end,
    'employeeStores', case when 'employeeStores' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data)) from (select employee_id, store_id from public.employee_stores where organization_id = target_organization_id) row_data), '[]'::jsonb) else '[]'::jsonb end,
    'employeeInvitations', case when 'employeeInvitations' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.created_at desc) from (select id, email, employee_number, job_title, role_name_snapshot, store_name_snapshot, expires_at, accepted_at, revoked_at, created_at from public.employee_invitations where organization_id = target_organization_id) row_data), '[]'::jsonb) else '[]'::jsonb end
  );
$function$;

create or replace function public.get_catalog_workspace_bundle_v1(
  target_organization_id uuid,
  requested_needs text[] default array[]::text[]
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $function$
  select jsonb_build_object(
    'categories', case when 'categories' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.sort_order, row_data.name) from (select id, name, is_archived, sort_order from public.categories where organization_id = target_organization_id) row_data), '[]'::jsonb) else '[]'::jsonb end,
    'stores', case when 'stores' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.created_at) from (select id, name, is_active, created_at from public.stores where organization_id = target_organization_id) row_data), '[]'::jsonb) else '[]'::jsonb end,
    'products', case when 'products' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.created_at desc) from (select id, category_id, name, description, product_type, sku, barcode, price_minor, track_inventory, unit, image_url, is_variable_price, allow_fractional_quantity, is_composite, composite_inventory_mode, status, created_at from public.products where organization_id = target_organization_id) row_data), '[]'::jsonb) else '[]'::jsonb end,
    'variants', case when 'variants' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.sort_order, row_data.name) from (select id, product_id, name, sku, barcode, price_minor, sort_order, is_active from public.product_variants where organization_id = target_organization_id) row_data), '[]'::jsonb) else '[]'::jsonb end,
    'productStoreSettings', case when 'productStoreSettings' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data)) from (select product_id, store_id, is_available, price_override_minor, low_stock_level, restock_policy from public.product_store_settings where organization_id = target_organization_id) row_data), '[]'::jsonb) else '[]'::jsonb end,
    'inventoryLevels', case when 'inventoryLevels' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data)) from (select product_id, variant_id, store_id, quantity from public.inventory_levels where organization_id = target_organization_id) row_data), '[]'::jsonb) else '[]'::jsonb end,
    'replenishmentRules', case when 'replenishmentRules' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data)) from (select product_id, variant_id, store_id, reorder_point from public.inventory_replenishment_rules where organization_id = target_organization_id) row_data), '[]'::jsonb) else '[]'::jsonb end,
    'productUnits', case when 'productUnits' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.is_base desc, row_data.unit_name) from (select id, product_id, unit_code, unit_name, factor_to_base, is_base, is_sale_unit, is_purchase_unit from public.product_units where organization_id = target_organization_id) row_data), '[]'::jsonb) else '[]'::jsonb end,
    'productComponents', case when 'productComponents' = any(coalesce(requested_needs, array[]::text[])) then coalesce((select jsonb_agg(to_jsonb(row_data)) from (select id, product_id, component_product_id, component_variant_id, quantity_per_composite from public.product_components where organization_id = target_organization_id) row_data), '[]'::jsonb) else '[]'::jsonb end
  );
$function$;

revoke all on function public.get_management_workspace_bundle_v1(uuid, text[]) from public;
grant execute on function public.get_management_workspace_bundle_v1(uuid, text[]) to tindio_authenticated;
revoke all on function public.get_catalog_workspace_bundle_v1(uuid, text[]) from public;
grant execute on function public.get_catalog_workspace_bundle_v1(uuid, text[]) to tindio_authenticated;

commit;
