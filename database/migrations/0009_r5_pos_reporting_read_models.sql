begin;

create or replace function public.get_pos_bootstrap_bundle_v1(
  target_organization_id uuid,
  target_store_ids uuid[],
  target_employee_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $function$
  select jsonb_build_object(
    'stores', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.created_at) from (select id, name, created_at from public.stores where organization_id = target_organization_id and is_active and id = any(coalesce(target_store_ids, array[]::uuid[]))) row_data), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.sort_order, row_data.name) from (select id, name, color, sort_order from public.categories where organization_id = target_organization_id and not is_archived) row_data), '[]'::jsonb),
    'registers', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.name) from (select id, store_id, name, code from public.registers where organization_id = target_organization_id and is_active and store_id = any(coalesce(target_store_ids, array[]::uuid[]))) row_data), '[]'::jsonb),
    'paymentMethods', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.sort_order, row_data.name) from (select id, name, code, payment_type, offline_policy, requires_reference, sort_order, is_loyalty_redemption from public.payment_methods where organization_id = target_organization_id and is_enabled) row_data), '[]'::jsonb),
    'storePaymentMethods', coalesce((select jsonb_agg(to_jsonb(row_data)) from (select store_id, payment_method_id from public.store_payment_methods where organization_id = target_organization_id and is_enabled and store_id = any(coalesce(target_store_ids, array[]::uuid[]))) row_data), '[]'::jsonb),
    'openShifts', coalesce((select jsonb_agg(to_jsonb(row_data)) from (select id, store_id, register_id, opening_cash_minor, opened_at from public.shifts where organization_id = target_organization_id and opened_by_employee_id = target_employee_id and status = 'open' order by opened_at desc limit 1) row_data), '[]'::jsonb),
    'loyaltyPrograms', coalesce((select jsonb_agg(to_jsonb(row_data)) from (select is_enabled, earn_spend_minor, earn_points, redemption_value_minor, minimum_redemption_points from public.loyalty_programs where organization_id = target_organization_id limit 1) row_data), '[]'::jsonb),
    'discounts', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.sort_order, row_data.name) from (select id, name, discount_type, percentage_bps, amount_minor, sort_order from public.discounts where organization_id = target_organization_id and is_active) row_data), '[]'::jsonb),
    'taxRates', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.name) from (select id, name, rate_bps, is_inclusive, is_default from public.tax_rates where organization_id = target_organization_id and is_active) row_data), '[]'::jsonb),
    'diningOptions', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.sort_order, row_data.name) from (select id, name, is_default, sort_order from public.dining_options where organization_id = target_organization_id and is_active) row_data), '[]'::jsonb),
    'ticketTemplates', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.sort_order, row_data.label) from (select id, label, note, dining_option_id, sort_order from public.ticket_templates where organization_id = target_organization_id and is_active) row_data), '[]'::jsonb)
  );
$function$;

create or replace function public.get_dashboard_readiness_snapshot_v1(
  target_organization_id uuid,
  include_inventory boolean default false
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $function$
  select jsonb_build_object(
    'stores', (select count(*) from public.stores where organization_id = target_organization_id and is_active),
    'products', (select count(*) from public.products where organization_id = target_organization_id and status = 'active'),
    'paymentMethods', (select count(*) from public.payment_methods where organization_id = target_organization_id and is_enabled),
    'inventoryLevels', case when include_inventory then (select count(*) from public.inventory_levels where organization_id = target_organization_id) else 0 end,
    'employees', (select count(*) from public.employees where organization_id = target_organization_id and status = 'active'),
    'registers', (select count(*) from public.registers where organization_id = target_organization_id and is_active)
  );
$function$;

create or replace function public.get_reports_store_reference_v1(
  target_organization_id uuid,
  target_store_ids uuid[] default null
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $function$
  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.name), '[]'::jsonb)
  from (
    select id, name
    from public.stores
    where organization_id = target_organization_id
      and is_active
      and (target_store_ids is null or id = any(target_store_ids))
  ) row_data;
$function$;

revoke all on function public.get_pos_bootstrap_bundle_v1(uuid, uuid[], uuid) from public;
grant execute on function public.get_pos_bootstrap_bundle_v1(uuid, uuid[], uuid) to tindio_authenticated;
revoke all on function public.get_dashboard_readiness_snapshot_v1(uuid, boolean) from public;
grant execute on function public.get_dashboard_readiness_snapshot_v1(uuid, boolean) to tindio_authenticated;
revoke all on function public.get_reports_store_reference_v1(uuid, uuid[]) from public;
grant execute on function public.get_reports_store_reference_v1(uuid, uuid[]) to tindio_authenticated;

commit;
