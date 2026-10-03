begin;

create or replace function public.create_inventory_count_plan_v2(
  target_organization_id uuid,
  target_store_id uuid,
  target_note text,
  target_count_mode text,
  target_scope_type text,
  target_selected_items jsonb,
  target_sort_mode text,
  target_include_zero_stock boolean,
  target_scope_reference_id uuid default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.create_inventory_count_plan(
    target_organization_id,
    target_store_id,
    target_note,
    target_count_mode,
    target_scope_type,
    target_scope_reference_id,
    target_selected_items,
    target_sort_mode,
    target_include_zero_stock
  );
$function$;

create or replace function public.save_inventory_count_line_v2(
  target_organization_id uuid,
  target_inventory_count_id uuid,
  target_product_id uuid,
  target_counted_quantity numeric,
  target_variant_id uuid default null
)
returns void
language sql
security invoker
set search_path = ''
as $function$
  select private.save_inventory_count_line(
    target_organization_id,
    target_inventory_count_id,
    target_product_id,
    target_variant_id,
    target_counted_quantity
  );
$function$;

create or replace function public.create_purchase_order_v2(
  target_organization_id uuid,
  target_store_id uuid,
  target_supplier_id uuid,
  target_notes text,
  target_lines jsonb,
  target_operation_id uuid,
  target_expected_at date default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.create_purchase_order(
    target_organization_id,
    target_store_id,
    target_supplier_id,
    target_notes,
    target_expected_at,
    target_lines,
    target_operation_id
  );
$function$;

create or replace function public.record_inventory_adjustment_v3(
  target_organization_id uuid,
  target_store_id uuid,
  target_product_id uuid,
  target_quantity_delta numeric,
  target_reason_code text,
  target_note text,
  target_operation_id uuid,
  target_approval_request_id uuid default null,
  target_variant_id uuid default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.record_inventory_adjustment(
    target_organization_id,
    target_store_id,
    target_product_id,
    target_variant_id,
    target_quantity_delta,
    target_reason_code,
    target_note,
    target_operation_id,
    target_approval_request_id
  );
$function$;

revoke all on function public.create_inventory_count_plan_v2(uuid, uuid, text, text, text, jsonb, text, boolean, uuid) from public, anon, service_role;
revoke all on function public.save_inventory_count_line_v2(uuid, uuid, uuid, numeric, uuid) from public, anon, service_role;
revoke all on function public.create_purchase_order_v2(uuid, uuid, uuid, text, jsonb, uuid, date) from public, anon, service_role;
revoke all on function public.record_inventory_adjustment_v3(uuid, uuid, uuid, numeric, text, text, uuid, uuid, uuid) from public, anon, service_role;

grant execute on function public.create_inventory_count_plan_v2(uuid, uuid, text, text, text, jsonb, text, boolean, uuid) to authenticated;
grant execute on function public.save_inventory_count_line_v2(uuid, uuid, uuid, numeric, uuid) to authenticated;
grant execute on function public.create_purchase_order_v2(uuid, uuid, uuid, text, jsonb, uuid, date) to authenticated;
grant execute on function public.record_inventory_adjustment_v3(uuid, uuid, uuid, numeric, text, text, uuid, uuid, uuid) to authenticated;

drop function if exists public.save_inventory_count_line(uuid, uuid, uuid, uuid, numeric);
drop function if exists public.create_inventory_count_plan(uuid, uuid, text, text, text, uuid, jsonb, text, boolean);
drop function if exists public.create_inventory_count_draft(uuid, uuid, text);
drop function if exists public.complete_inventory_count(uuid, uuid, text, jsonb);
drop function if exists public.post_inventory_count(uuid, uuid);
drop function if exists public.create_purchase_order(uuid, uuid, uuid, text, date, jsonb, uuid);
drop function if exists public.record_inventory_adjustment(uuid, uuid, uuid, uuid, numeric, text, text, uuid, uuid);

comment on function public.create_inventory_count_plan_v2(uuid, uuid, text, text, text, jsonb, text, boolean, uuid)
  is 'Canonical public inventory count preparation API. Scope reference is optional for full-store and selected counts.';
comment on function public.save_inventory_count_line_v2(uuid, uuid, uuid, numeric, uuid)
  is 'Canonical physical-count save API. Variant is optional for simple products and validated for variable products.';
comment on function public.create_purchase_order_v2(uuid, uuid, uuid, text, jsonb, uuid, date)
  is 'Canonical replay-safe purchase order API. Omitted expected date requests supplier/default scheduling.';
comment on function public.record_inventory_adjustment_v3(uuid, uuid, uuid, numeric, text, text, uuid, uuid, uuid)
  is 'Canonical controlled replay-safe inventory adjustment API with optional approval and product variant.';

notify pgrst, 'reload schema';

commit;
