begin;

create extension if not exists pgtap with schema extensions;

select plan(35);

select ok(to_regprocedure('public.get_dashboard_snapshot(uuid,date,date,uuid)') is not null, 'dashboard snapshot routine exists');
select ok(to_regprocedure('public.get_reports_snapshot(uuid,date,date,uuid)') is not null, 'reports snapshot routine exists');
select ok(to_regclass('public.sales_organization_completed_report_idx') is not null, 'sales reporting index exists');
select ok(to_regclass('public.refunds_organization_store_completed_report_idx') is not null, 'refund reporting index exists');
select ok(to_regclass('public.inventory_movements_organization_store_created_idx') is not null, 'inventory reporting index exists');
select ok(to_regclass('public.inventory_movements_organization_store_created_report_idx') is null, 'duplicate inventory reporting index is removed');
select ok(to_regclass('public.shifts_organization_closed_report_idx') is not null, 'closed shift reporting index exists');
select ok(not has_function_privilege('anon', 'public.get_dashboard_snapshot(uuid,date,date,uuid)', 'execute'), 'anonymous callers cannot read dashboard snapshots');
select ok(not has_function_privilege('anon', 'public.get_reports_snapshot(uuid,date,date,uuid)', 'execute'), 'anonymous callers cannot read reports snapshots');
select ok(not has_function_privilege('authenticated', 'private.get_reporting_snapshot(uuid,date,date,uuid,text)', 'execute'), 'raw reporting implementation is not directly executable by authenticated callers');
select ok(has_function_privilege('authenticated', 'private.get_scoped_reporting_snapshot(uuid,date,date,uuid,text)', 'execute'), 'authenticated callers can execute the scope-protected reporting implementation');
select ok(not has_function_privilege('anon', 'private.get_reporting_snapshot(uuid,date,date,uuid,text)', 'execute'), 'anonymous callers cannot execute the protected reporting implementation');

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a1010101-0101-4101-8101-010101010101', 'report-owner@tindio.test', '{"full_name":"Report Owner"}'::jsonb),
  ('a2020202-0202-4202-8202-020202020202', 'report-outsider@tindio.test', '{"full_name":"Report Outsider"}'::jsonb),
  ('a4040404-0404-4404-8404-040404040404', 'report-manager@tindio.test', '{"full_name":"Report Manager"}'::jsonb);

create temporary table reports_test_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  product_id uuid,
  secondary_store_id uuid,
  manager_employee_id uuid,
  report_date date not null default (now() at time zone 'Asia/Manila')::date
);

grant select, insert, update on reports_test_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'a1010101-0101-4101-8101-010101010101';

insert into reports_test_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization('Reports Test Retail', 'Reports Main', 'Reports Counter');

select ok(exists (select 1 from public.employees where organization_id = (select organization_id from reports_test_context)), 'bootstrap creates the report owner employee');

update reports_test_context
set product_id = public.create_catalog_product(
  organization_id,
  null,
  'Reports Test Item',
  'A reporting fixture',
  'simple',
  'REPORT-ITEM',
  '480000100001',
  10000,
  4000,
  false,
  'each',
  array[store_id],
  '[]'::jsonb
);

select lives_ok(
  format(
    $$select public.open_register_shift(%L, %L, %L, 0, null)$$,
    (select organization_id from reports_test_context),
    (select store_id from reports_test_context),
    (select register_id from reports_test_context)
  ),
  'report owner opens a shift for the reporting sale'
);

select lives_ok(
  format(
    $$select public.checkout_sale(%L, %L, %L, 'a3030303-0303-4303-8303-030303030303', %L::jsonb, %L::jsonb, null, 0)$$,
    (select organization_id from reports_test_context),
    (select store_id from reports_test_context),
    (select register_id from reports_test_context),
    jsonb_build_array(jsonb_build_object(
      'product_id', (select product_id from reports_test_context),
      'variant_id', null,
      'quantity', 1
    )),
    jsonb_build_array(jsonb_build_object(
      'payment_method_id', (select id from public.payment_methods where organization_id = (select organization_id from reports_test_context) and code = 'CASH'),
      'amount_tendered_minor', 10000
    ))
  ),
  'checkout creates a sale for report aggregation'
);

select lives_ok(
  format(
    $$select public.get_reports_snapshot(%L, %L::date, %L::date, null)$$,
    (select organization_id from reports_test_context),
    (select report_date from reports_test_context),
    (select report_date from reports_test_context)
  ),
  'authorized report snapshot succeeds'
);
select is(
  (public.get_reports_snapshot((select organization_id from reports_test_context), (select report_date from reports_test_context), (select report_date from reports_test_context), null)->'summary'->>'sales_total_minor')::bigint,
  10000::bigint,
  'reports aggregate completed sale value'
);
select is(
  (public.get_reports_snapshot((select organization_id from reports_test_context), (select report_date from reports_test_context), (select report_date from reports_test_context), null)->'summary'->>'net_sales_minor')::bigint,
  10000::bigint,
  'reports calculate net sales without refunds'
);
select is(
  (public.get_reports_snapshot((select organization_id from reports_test_context), (select report_date from reports_test_context), (select report_date from reports_test_context), null)->'summary'->>'transaction_count')::integer,
  1,
  'reports count completed transactions'
);
select is(
  (public.get_reports_snapshot((select organization_id from reports_test_context), (select report_date from reports_test_context), (select report_date from reports_test_context), null)->'summary'->>'estimated_gross_profit_minor')::bigint,
  6000::bigint,
  'cost-authorized reports calculate gross profit estimate'
);
select is(
  (public.get_reports_snapshot((select organization_id from reports_test_context), (select report_date from reports_test_context), (select report_date from reports_test_context), null)->'summary'->>'cogs_minor')::bigint,
  4000::bigint,
  'reports use immutable sale-item COGS snapshots'
);
select is(
  (public.get_reports_snapshot((select organization_id from reports_test_context), (select report_date from reports_test_context), (select report_date from reports_test_context), null)->'summary'->>'gross_profit_minor')::bigint,
  6000::bigint,
  'reports expose recorded gross profit'
);
select is(
  (public.get_reports_snapshot((select organization_id from reports_test_context), (select report_date from reports_test_context), (select report_date from reports_test_context), null)->'summary'->>'gross_margin_bps')::integer,
  6000,
  'reports calculate gross margin in basis points'
);
select is(
  (public.get_reports_snapshot((select organization_id from reports_test_context), (select report_date from reports_test_context), (select report_date from reports_test_context), null)->'payments'->0->>'amount_minor')::bigint,
  10000::bigint,
  'reports include applied payment totals'
);
select is(
  public.get_reports_snapshot((select organization_id from reports_test_context), (select report_date from reports_test_context), (select report_date from reports_test_context), null)->'top_products'->0->>'name',
  'Reports Test Item',
  'reports preserve sale item snapshots for top products'
);
select is(
  (public.get_dashboard_snapshot((select organization_id from reports_test_context), (select report_date from reports_test_context), (select report_date from reports_test_context), null)->'summary'->>'sales_total_minor')::bigint,
  10000::bigint,
  'dashboard snapshot uses the same authoritative sales ledger'
);
select is(
  jsonb_typeof(public.get_reports_snapshot((select organization_id from reports_test_context), (select report_date from reports_test_context), (select report_date from reports_test_context), null)->'sales_by_register'),
  'array',
  'reports expose a register breakdown'
);
select ok(
  public.get_reports_snapshot((select organization_id from reports_test_context), (select report_date from reports_test_context), (select report_date from reports_test_context), null)->'inventory' ? 'low_stock_count',
  'reports expose inventory health counts'
);
select ok(
  public.get_reports_snapshot((select organization_id from reports_test_context), (select report_date from reports_test_context), (select report_date from reports_test_context), null) ? 'security',
  'reports expose the security and accountability section'
);

insert into public.stores (organization_id, name, code)
select organization_id, 'Reports Secondary', 'REPORT-02'
from reports_test_context;

update reports_test_context context
set secondary_store_id = store.id
from public.stores store
where store.organization_id = context.organization_id
  and store.code = 'REPORT-02';

insert into public.employees (organization_id, profile_id, employee_number, job_title)
select organization_id, 'a4040404-0404-4404-8404-040404040404', 'REPORT-MANAGER', 'Report Manager'
from reports_test_context;

update reports_test_context context
set manager_employee_id = employee.id
from public.employees employee
where employee.organization_id = context.organization_id
  and employee.profile_id = 'a4040404-0404-4404-8404-040404040404';

insert into public.employee_roles (organization_id, employee_id, role_id)
select context.organization_id, context.manager_employee_id, role.id
from reports_test_context context
join public.roles role
  on role.organization_id = context.organization_id
 and role.code = 'manager';

insert into public.employee_stores (organization_id, employee_id, store_id)
select organization_id, manager_employee_id, store_id
from reports_test_context;

set local request.jwt.claim.sub = 'a4040404-0404-4404-8404-040404040404';
select lives_ok(
  format(
    $$select public.get_dashboard_snapshot(%L, %L::date, %L::date, %L::uuid)$$,
    (select organization_id from reports_test_context),
    (select report_date from reports_test_context),
    (select report_date from reports_test_context),
    (select store_id from reports_test_context)
  ),
  'manager dashboard succeeds for an assigned store'
);

create or replace function pg_temp.unscoped_manager_report_is_rejected() returns boolean language plpgsql as $$
begin
  perform public.get_reports_snapshot((select organization_id from reports_test_context), (select report_date from reports_test_context), (select report_date from reports_test_context), null);
  return false;
exception when insufficient_privilege then
  return true;
end;
$$;
select ok(pg_temp.unscoped_manager_report_is_rejected(), 'manager cannot request organization-wide reporting');

create or replace function pg_temp.unassigned_store_manager_report_is_rejected() returns boolean language plpgsql as $$
begin
  perform public.get_reports_snapshot((select organization_id from reports_test_context), (select report_date from reports_test_context), (select report_date from reports_test_context), (select secondary_store_id from reports_test_context));
  return false;
exception when insufficient_privilege then
  return true;
end;
$$;
select ok(pg_temp.unassigned_store_manager_report_is_rejected(), 'manager cannot request reporting for an unassigned store');

select lives_ok(
  format(
    $$select public.get_reports_snapshot(%L, %L::date, %L::date, %L::uuid)$$,
    (select organization_id from reports_test_context),
    (select report_date from reports_test_context),
    (select report_date from reports_test_context),
    (select store_id from reports_test_context)
  ),
  'manager reports succeed for an assigned store'
);

create or replace function pg_temp.report_access_is_rejected() returns boolean language plpgsql as $$
begin
  perform public.get_reports_snapshot((select organization_id from reports_test_context), (select report_date from reports_test_context), (select report_date from reports_test_context), null);
  return false;
exception when insufficient_privilege then
  return true;
end;
$$;

set local request.jwt.claim.sub = 'a2020202-0202-4202-8202-020202020202';
select ok(pg_temp.report_access_is_rejected(), 'unassigned users cannot read organization reports');

set local request.jwt.claim.sub = 'a1010101-0101-4101-8101-010101010101';
create or replace function pg_temp.invalid_report_range_is_rejected() returns boolean language plpgsql as $$
begin
  perform public.get_reports_snapshot((select organization_id from reports_test_context), (select report_date - 366 from reports_test_context), (select report_date from reports_test_context), null);
  return false;
exception when invalid_parameter_value then
  return true;
end;
$$;

select ok(pg_temp.invalid_report_range_is_rejected(), 'reports reject ranges longer than 366 days');

select * from finish();
rollback;
