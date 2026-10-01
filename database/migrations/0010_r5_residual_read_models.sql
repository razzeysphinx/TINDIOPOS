begin;

create or replace function public.get_receipt_detail_bundle_v1(
  target_organization_id uuid,
  target_receipt_id uuid,
  include_reprint_extensions boolean default false,
  include_refund_methods boolean default false
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $function$
  with receipt_row as (
    select id, sale_id, receipt_number, issued_at, receipt_layout_snapshot
    from public.receipts where id = target_receipt_id and organization_id = target_organization_id
  ), sale_row as (
    select s.id, s.store_id, s.customer_id, s.currency_code, s.organization_name_snapshot, s.store_name_snapshot, s.register_name_snapshot, s.cashier_name_snapshot, s.subtotal_minor, s.discount_minor, s.tax_minor, s.total_minor
    from public.sales s join receipt_row r on r.sale_id = s.id where s.organization_id = target_organization_id
  ), refund_rows as (
    select r.id, r.refund_number, r.total_minor, r.completed_at, r.reason from public.refunds r join sale_row s on s.id = r.sale_id where r.organization_id = target_organization_id
  )
  select jsonb_build_object(
    'receipts', coalesce((select jsonb_agg(to_jsonb(x)) from receipt_row x), '[]'::jsonb),
    'sales', coalesce((select jsonb_agg(to_jsonb(x)) from sale_row x), '[]'::jsonb),
    'saleItems', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (select i.id, i.product_name_snapshot, i.variant_name_snapshot, i.sku_snapshot, i.unit_snapshot, i.quantity, i.unit_price_minor, i.line_total_minor, i.created_at from public.sale_items i join sale_row s on s.id=i.sale_id where i.organization_id=target_organization_id) x), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (select p.id, p.payment_method_name_snapshot, p.payment_method_type_snapshot, p.amount_minor, p.amount_tendered_minor, p.change_given_minor, p.reference_number, p.created_at from public.payments p join sale_row s on s.id=p.sale_id where p.organization_id=target_organization_id) x), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(to_jsonb(x) order by x.completed_at desc) from refund_rows x), '[]'::jsonb),
    'refundItems', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (select i.id, i.refund_id, i.sale_item_id, i.product_name_snapshot, i.variant_name_snapshot, i.quantity, i.unit_snapshot, i.line_total_minor, i.returned_to_stock, i.created_at from public.refund_items i join refund_rows r on r.id=i.refund_id where i.organization_id=target_organization_id) x), '[]'::jsonb),
    'refundPayments', coalesce((select jsonb_agg(to_jsonb(x)) from (select p.refund_id, p.payment_method_name_snapshot, p.reference_number from public.refund_payments p join refund_rows r on r.id=p.refund_id where p.organization_id=target_organization_id) x), '[]'::jsonb),
    'exchanges', coalesce((select jsonb_agg(to_jsonb(x)) from (select e.id, e.refund_id, e.replacement_sale_id, e.created_at from public.sale_exchanges e join refund_rows r on r.id=e.refund_id where e.organization_id=target_organization_id) x), '[]'::jsonb),
    'replacementReceipts', coalesce((select jsonb_agg(to_jsonb(x)) from (select r.sale_id, r.receipt_number from public.receipts r where r.organization_id=target_organization_id and r.sale_id in (select replacement_sale_id from public.sale_exchanges e join refund_rows f on f.id=e.refund_id where e.organization_id=target_organization_id)) x), '[]'::jsonb),
    'deliveries', case when include_reprint_extensions then coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id, recipient, status, created_at from public.receipt_delivery_requests where organization_id=target_organization_id and receipt_id=target_receipt_id order by created_at desc limit 5) x), '[]'::jsonb) else '[]'::jsonb end,
    'customerEmails', case when include_reprint_extensions then coalesce((select jsonb_agg(to_jsonb(x)) from (select c.email from public.customers c join sale_row s on s.customer_id=c.id where c.organization_id=target_organization_id) x), '[]'::jsonb) else '[]'::jsonb end,
    'paymentMethods', case when include_refund_methods then coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order, x.name) from (select id, name, payment_type, requires_reference, sort_order from public.payment_methods where organization_id=target_organization_id and is_enabled) x), '[]'::jsonb) else '[]'::jsonb end,
    'storePaymentMethods', case when include_refund_methods then coalesce((select jsonb_agg(to_jsonb(x)) from (select spm.payment_method_id from public.store_payment_methods spm join sale_row s on s.store_id=spm.store_id where spm.organization_id=target_organization_id and spm.is_enabled) x), '[]'::jsonb) else '[]'::jsonb end
  );
$function$;

create or replace function public.get_time_clock_workspace_bundle_v1(
  target_organization_id uuid,
  target_store_ids uuid[],
  target_store_id uuid default null,
  target_employee_id uuid default null,
  target_start timestamptz default null,
  target_end timestamptz default null,
  include_attendance boolean default false
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $function$
  select jsonb_build_object(
    'stores', coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from (select id, name, is_active from public.stores where organization_id=target_organization_id and id=any(coalesce(target_store_ids,array[]::uuid[]))) x), '[]'::jsonb),
    'entries', case when include_attendance then coalesce((select jsonb_agg(to_jsonb(x) order by x.clocked_in_at desc) from (select id, employee_id, store_id, clocked_in_at, clocked_out_at, clock_in_verification_method, clock_out_verification_method from public.time_clock_entries where organization_id=target_organization_id and (target_store_id is null or store_id=target_store_id) and (target_employee_id is null or employee_id=target_employee_id) and (target_start is null or clocked_in_at>=target_start) and (target_end is null or clocked_in_at<=target_end) order by clocked_in_at desc limit 200) x), '[]'::jsonb) else '[]'::jsonb end,
    'employees', case when include_attendance then coalesce((select jsonb_agg(to_jsonb(x) order by x.employee_number) from (select id, profile_id, employee_number from public.employees where organization_id=target_organization_id) x), '[]'::jsonb) else '[]'::jsonb end,
    'profiles', case when include_attendance then coalesce((select jsonb_agg(to_jsonb(x)) from (select p.id, p.full_name, p.email from public.profiles p join public.employees e on e.profile_id=p.id where e.organization_id=target_organization_id) x), '[]'::jsonb) else '[]'::jsonb end,
    'clockedInCount', case when include_attendance then (select count(*) from public.time_clock_entries where organization_id=target_organization_id and clocked_out_at is null) else 0 end
  );
$function$;

revoke all on function public.get_receipt_detail_bundle_v1(uuid, uuid, boolean, boolean) from public;
grant execute on function public.get_receipt_detail_bundle_v1(uuid, uuid, boolean, boolean) to tindio_authenticated;
revoke all on function public.get_time_clock_workspace_bundle_v1(uuid, uuid[], uuid, uuid, timestamptz, timestamptz, boolean) from public;
grant execute on function public.get_time_clock_workspace_bundle_v1(uuid, uuid[], uuid, uuid, timestamptz, timestamptz, boolean) to tindio_authenticated;

commit;
