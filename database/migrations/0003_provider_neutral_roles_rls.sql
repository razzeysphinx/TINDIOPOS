begin;

-- TINDIO-owned database access classes.
do $tindio_roles$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'tindio_anon'
  ) then
    create role tindio_anon nologin inherit;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'tindio_authenticated'
  ) then
    create role tindio_authenticated nologin inherit;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'tindio_service'
  ) then
    create role tindio_service nologin inherit;
  end if;
end;
$tindio_roles$;

alter role tindio_anon nologin inherit;
alter role tindio_authenticated nologin inherit;
alter role tindio_service nologin inherit;

CREATE OR REPLACE FUNCTION "private"."current_identity_email_matches"("target_email" text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $tindio_identity_email$
  select
    private.current_identity_email() is not null
    and lower(trim(coalesce(target_email, '')))
      = private.current_identity_email();
$tindio_identity_email$;

REVOKE ALL
ON FUNCTION "private"."current_identity_email_matches"(text)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION "private"."current_identity_email_matches"(text)
TO "tindio_authenticated";

CREATE OR REPLACE FUNCTION "public"."update_receipt_delivery_status"("target_delivery_request_id" "uuid", "target_status" "text", "target_provider_message_id" "text" DEFAULT NULL::"text", "target_failure_reason" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  delivery_record public.receipt_delivery_requests%rowtype;
  normalized_status text;
  normalized_provider_message_id text;
  normalized_failure_reason text;
begin
normalized_status := upper(trim(coalesce(target_status, '')));
  normalized_provider_message_id := nullif(trim(coalesce(target_provider_message_id, '')), '');
  normalized_failure_reason := nullif(trim(coalesce(target_failure_reason, '')), '');

  if normalized_status not in ('DELIVERED', 'FAILED')
    or (normalized_status = 'FAILED' and char_length(coalesce(normalized_failure_reason, '')) not between 2 and 500)
    or (normalized_provider_message_id is not null and char_length(normalized_provider_message_id) not between 1 and 320) then
    raise exception 'Check the receipt delivery status result.' using errcode = '23514';
  end if;

  select request.*
  into delivery_record
  from public.receipt_delivery_requests request
  where request.id = target_delivery_request_id
  for update;

  if delivery_record.id is null then
    raise exception 'The receipt delivery request was not found.' using errcode = 'P0002';
  end if;

  if delivery_record.status = normalized_status then
    return true;
  end if;

  if delivery_record.status <> 'QUEUED' then
    raise exception 'Only a queued receipt delivery request can be completed.' using errcode = '23514';
  end if;

  update public.receipt_delivery_requests request
  set
    status = normalized_status,
    provider_message_id = normalized_provider_message_id,
    delivered_at = case when normalized_status = 'DELIVERED' then now() else null end,
    failed_at = case when normalized_status = 'FAILED' then now() else null end,
    failure_reason = case when normalized_status = 'FAILED' then normalized_failure_reason else null end
  where request.id = delivery_record.id;

  return true;
end;
$$;

-- Rebuild canonical RLS policies against TINDIO-owned access classes.

DROP POLICY IF EXISTS "approval_requests_select_requester_or_store_approver" ON "public"."approval_requests";
CREATE POLICY "approval_requests_select_requester_or_store_approver" ON "public"."approval_requests" FOR SELECT TO "tindio_authenticated" USING ((("requested_by_employee_id" = ( SELECT "private"."current_employee_id"("approval_requests"."organization_id") AS "current_employee_id")) OR ((( SELECT "private"."has_permission"("approval_requests"."organization_id", 'approvals.authorize'::"text") AS "has_permission") OR ( SELECT "private"."has_permission"("approval_requests"."organization_id", 'approvals.manage'::"text") AS "has_permission")) AND (EXISTS ( SELECT 1
   FROM "public"."employee_stores" "employee_store"
  WHERE (("employee_store"."organization_id" = "approval_requests"."organization_id") AND ("employee_store"."employee_id" = ( SELECT "private"."current_employee_id"("approval_requests"."organization_id") AS "current_employee_id")) AND ("employee_store"."store_id" = "approval_requests"."store_id")))))));

DROP POLICY IF EXISTS "approval_rules_select_member" ON "public"."approval_rules";
CREATE POLICY "approval_rules_select_member" ON "public"."approval_rules" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."is_organization_member"("approval_rules"."organization_id") AS "is_organization_member"));

DROP POLICY IF EXISTS "audit_logs_select_authorized" ON "public"."audit_logs";
CREATE POLICY "audit_logs_select_authorized" ON "public"."audit_logs" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("audit_logs"."organization_id", 'audit.view'::"text") AS "has_permission") AND ((("store_id" IS NOT NULL) AND ( SELECT "private"."has_store_read_scope"("audit_logs"."organization_id", "audit_logs"."store_id") AS "has_store_read_scope")) OR (("store_id" IS NULL) AND ( SELECT "private"."has_permission"("audit_logs"."organization_id", 'stores.manage'::"text") AS "has_permission")))));

DROP POLICY IF EXISTS "cash_movements_select_authorized" ON "public"."cash_movements";
CREATE POLICY "cash_movements_select_authorized" ON "public"."cash_movements" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."has_shift_access"("cash_movements"."organization_id", "cash_movements"."store_id") AS "has_shift_access"));

DROP POLICY IF EXISTS "categories_insert_authorized" ON "public"."categories";
CREATE POLICY "categories_insert_authorized" ON "public"."categories" FOR INSERT TO "tindio_authenticated" WITH CHECK (( SELECT "private"."has_permission"("categories"."organization_id", 'products.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "categories_select_member" ON "public"."categories";
CREATE POLICY "categories_select_member" ON "public"."categories" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."is_organization_member"("categories"."organization_id") AS "is_organization_member"));

DROP POLICY IF EXISTS "categories_update_authorized" ON "public"."categories";
CREATE POLICY "categories_update_authorized" ON "public"."categories" FOR UPDATE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("categories"."organization_id", 'products.manage'::"text") AS "has_permission")) WITH CHECK (( SELECT "private"."has_permission"("categories"."organization_id", 'products.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "customer_segment_memberships_select_manager" ON "public"."customer_segment_memberships";
CREATE POLICY "customer_segment_memberships_select_manager" ON "public"."customer_segment_memberships" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("customer_segment_memberships"."organization_id", 'customers.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "customer_segments_select_manager" ON "public"."customer_segments";
CREATE POLICY "customer_segments_select_manager" ON "public"."customer_segments" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("customer_segments"."organization_id", 'customers.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "customers_insert_manager" ON "public"."customers";
CREATE POLICY "customers_insert_manager" ON "public"."customers" FOR INSERT TO "tindio_authenticated" WITH CHECK (( SELECT "private"."has_permission"("customers"."organization_id", 'customers.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "customers_select_manager" ON "public"."customers";
CREATE POLICY "customers_select_manager" ON "public"."customers" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("customers"."organization_id", 'customers.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "customers_update_manager" ON "public"."customers";
CREATE POLICY "customers_update_manager" ON "public"."customers" FOR UPDATE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("customers"."organization_id", 'customers.manage'::"text") AS "has_permission")) WITH CHECK (( SELECT "private"."has_permission"("customers"."organization_id", 'customers.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "dining_options_insert_authorized" ON "public"."dining_options";
CREATE POLICY "dining_options_insert_authorized" ON "public"."dining_options" FOR INSERT TO "tindio_authenticated" WITH CHECK (( SELECT "private"."has_permission"("dining_options"."organization_id", 'products.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "dining_options_select_sales_or_manager" ON "public"."dining_options";
CREATE POLICY "dining_options_select_sales_or_manager" ON "public"."dining_options" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("dining_options"."organization_id", 'sales.create'::"text") AS "has_permission") OR ( SELECT "private"."has_permission"("dining_options"."organization_id", 'products.manage'::"text") AS "has_permission")));

DROP POLICY IF EXISTS "dining_options_update_authorized" ON "public"."dining_options";
CREATE POLICY "dining_options_update_authorized" ON "public"."dining_options" FOR UPDATE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("dining_options"."organization_id", 'products.manage'::"text") AS "has_permission")) WITH CHECK (( SELECT "private"."has_permission"("dining_options"."organization_id", 'products.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "discounts_insert_authorized" ON "public"."discounts";
CREATE POLICY "discounts_insert_authorized" ON "public"."discounts" FOR INSERT TO "tindio_authenticated" WITH CHECK (( SELECT "private"."has_permission"("discounts"."organization_id", 'products.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "discounts_select_sales_or_manager" ON "public"."discounts";
CREATE POLICY "discounts_select_sales_or_manager" ON "public"."discounts" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("discounts"."organization_id", 'sales.create'::"text") AS "has_permission") OR ( SELECT "private"."has_permission"("discounts"."organization_id", 'products.manage'::"text") AS "has_permission")));

DROP POLICY IF EXISTS "discounts_update_authorized" ON "public"."discounts";
CREATE POLICY "discounts_update_authorized" ON "public"."discounts" FOR UPDATE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("discounts"."organization_id", 'products.manage'::"text") AS "has_permission")) WITH CHECK (( SELECT "private"."has_permission"("discounts"."organization_id", 'products.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "employee_invitations_insert_authorized" ON "public"."employee_invitations";
CREATE POLICY "employee_invitations_insert_authorized" ON "public"."employee_invitations" FOR INSERT TO "tindio_authenticated" WITH CHECK ((( SELECT "private"."has_permission"("employee_invitations"."organization_id", 'employees.manage'::"text") AS "has_permission") AND ( SELECT "private"."can_grant_role"("employee_invitations"."organization_id", "employee_invitations"."role_id") AS "can_grant_role") AND (EXISTS ( SELECT 1
   FROM "public"."employees" "inviter"
  WHERE (("inviter"."id" = "employee_invitations"."invited_by") AND ("inviter"."organization_id" = "employee_invitations"."organization_id") AND ("inviter"."profile_id" = ( SELECT "public"."current_profile_id"() AS "uid")) AND ("inviter"."status" = 'active'::"text"))))));

DROP POLICY IF EXISTS "employee_invitations_revoke_authorized" ON "public"."employee_invitations";
CREATE POLICY "employee_invitations_revoke_authorized" ON "public"."employee_invitations" FOR UPDATE TO "tindio_authenticated" USING ((("accepted_at" IS NULL) AND ( SELECT "private"."has_permission"("employee_invitations"."organization_id", 'employees.manage'::"text") AS "has_permission"))) WITH CHECK ((("accepted_at" IS NULL) AND ("revoked_at" IS NOT NULL) AND ( SELECT "private"."has_permission"("employee_invitations"."organization_id", 'employees.manage'::"text") AS "has_permission")));

DROP POLICY IF EXISTS "employee_invitations_select_authorized" ON "public"."employee_invitations";
CREATE POLICY "employee_invitations_select_authorized" ON "public"."employee_invitations" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("employee_invitations"."organization_id", 'employees.manage'::"text") AS "has_permission") OR (("accepted_at" IS NULL) AND ("revoked_at" IS NULL) AND ("expires_at" > "now"()) AND (( SELECT "private"."current_identity_email_matches"("employee_invitations"."email") AS "current_identity_email_matches")))));

DROP POLICY IF EXISTS "employee_roles_delete_authorized" ON "public"."employee_roles";
CREATE POLICY "employee_roles_delete_authorized" ON "public"."employee_roles" FOR DELETE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("employee_roles"."organization_id", 'employees.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "employee_roles_insert_authorized" ON "public"."employee_roles";
CREATE POLICY "employee_roles_insert_authorized" ON "public"."employee_roles" FOR INSERT TO "tindio_authenticated" WITH CHECK ((( SELECT "private"."is_organization_creator"("employee_roles"."organization_id") AS "is_organization_creator") OR (( SELECT "private"."has_permission"("employee_roles"."organization_id", 'employees.manage'::"text") AS "has_permission") AND ( SELECT "private"."can_grant_role"("employee_roles"."organization_id", "employee_roles"."role_id") AS "can_grant_role"))));

DROP POLICY IF EXISTS "employee_roles_select_authorized" ON "public"."employee_roles";
CREATE POLICY "employee_roles_select_authorized" ON "public"."employee_roles" FOR SELECT TO "tindio_authenticated" USING ((("employee_id" = ( SELECT "private"."current_employee_id"("employee_roles"."organization_id") AS "current_employee_id")) OR (( SELECT "private"."has_permission"("employee_roles"."organization_id", 'employees.manage'::"text") AS "has_permission") AND ( SELECT "private"."can_access_employee_store_scope"("employee_roles"."organization_id", "employee_roles"."employee_id") AS "can_access_employee_store_scope"))));

DROP POLICY IF EXISTS "employee_stores_delete_authorized" ON "public"."employee_stores";
CREATE POLICY "employee_stores_delete_authorized" ON "public"."employee_stores" FOR DELETE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("employee_stores"."organization_id", 'employees.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "employee_stores_insert_authorized" ON "public"."employee_stores";
CREATE POLICY "employee_stores_insert_authorized" ON "public"."employee_stores" FOR INSERT TO "tindio_authenticated" WITH CHECK ((( SELECT "private"."is_organization_creator"("employee_stores"."organization_id") AS "is_organization_creator") OR ( SELECT "private"."has_permission"("employee_stores"."organization_id", 'employees.manage'::"text") AS "has_permission")));

DROP POLICY IF EXISTS "employee_stores_select_authorized" ON "public"."employee_stores";
CREATE POLICY "employee_stores_select_authorized" ON "public"."employee_stores" FOR SELECT TO "tindio_authenticated" USING ((("employee_id" = ( SELECT "private"."current_employee_id"("employee_stores"."organization_id") AS "current_employee_id")) OR (( SELECT "private"."has_permission"("employee_stores"."organization_id", 'employees.manage'::"text") AS "has_permission") AND ( SELECT "private"."has_store_read_scope"("employee_stores"."organization_id", "employee_stores"."store_id") AS "has_store_read_scope"))));

DROP POLICY IF EXISTS "employees_insert_authorized" ON "public"."employees";
CREATE POLICY "employees_insert_authorized" ON "public"."employees" FOR INSERT TO "tindio_authenticated" WITH CHECK ((( SELECT "private"."is_organization_creator"("employees"."organization_id") AS "is_organization_creator") OR ( SELECT "private"."has_permission"("employees"."organization_id", 'employees.manage'::"text") AS "has_permission")));

DROP POLICY IF EXISTS "employees_select_authorized" ON "public"."employees";
CREATE POLICY "employees_select_authorized" ON "public"."employees" FOR SELECT TO "tindio_authenticated" USING ((("profile_id" = ( SELECT "public"."current_profile_id"() AS "uid")) OR (( SELECT "private"."has_permission"("employees"."organization_id", 'employees.manage'::"text") AS "has_permission") AND ( SELECT "private"."can_access_employee_store_scope"("employees"."organization_id", "employees"."id") AS "can_access_employee_store_scope"))));

DROP POLICY IF EXISTS "employees_update_authorized" ON "public"."employees";
CREATE POLICY "employees_update_authorized" ON "public"."employees" FOR UPDATE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("employees"."organization_id", 'employees.manage'::"text") AS "has_permission")) WITH CHECK (( SELECT "private"."has_permission"("employees"."organization_id", 'employees.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "goods_receipt_lines_select_purchasing_scope" ON "public"."goods_receipt_lines";
CREATE POLICY "goods_receipt_lines_select_purchasing_scope" ON "public"."goods_receipt_lines" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_any_inventory_capability"("goods_receipt_lines"."organization_id", ARRAY['purchasing.view'::"text", 'purchasing.receive'::"text"]) AS "has_any_inventory_capability") AND (EXISTS ( SELECT 1
   FROM "public"."goods_receipts" "goods_receipt"
  WHERE (("goods_receipt"."id" = "goods_receipt_lines"."goods_receipt_id") AND ("goods_receipt"."organization_id" = "goods_receipt_lines"."organization_id") AND ( SELECT "private"."has_store_read_scope"("goods_receipt"."organization_id", "goods_receipt"."store_id") AS "has_store_read_scope"))))));

DROP POLICY IF EXISTS "goods_receipts_select_purchasing_scope" ON "public"."goods_receipts";
CREATE POLICY "goods_receipts_select_purchasing_scope" ON "public"."goods_receipts" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_any_inventory_capability"("goods_receipts"."organization_id", ARRAY['purchasing.view'::"text", 'purchasing.receive'::"text"]) AS "has_any_inventory_capability") AND ( SELECT "private"."has_store_read_scope"("goods_receipts"."organization_id", "goods_receipts"."store_id") AS "has_store_read_scope")));

DROP POLICY IF EXISTS "inventory_adjustment_import_batches_select_authorized_scope" ON "public"."inventory_adjustment_import_batches";
CREATE POLICY "inventory_adjustment_import_batches_select_authorized_scope" ON "public"."inventory_adjustment_import_batches" FOR SELECT TO "tindio_authenticated" USING (((( SELECT "private"."has_permission"("inventory_adjustment_import_batches"."organization_id", 'inventory.view'::"text") AS "has_permission") OR ( SELECT "private"."has_any_inventory_capability"("inventory_adjustment_import_batches"."organization_id", ARRAY['inventory.adjust.create'::"text", 'inventory.adjust.post'::"text"]) AS "has_any_inventory_capability")) AND ( SELECT "private"."has_store_read_scope"("inventory_adjustment_import_batches"."organization_id", "inventory_adjustment_import_batches"."store_id") AS "has_store_read_scope")));

DROP POLICY IF EXISTS "inventory_adjustment_reasons_select_adjuster" ON "public"."inventory_adjustment_reasons";
CREATE POLICY "inventory_adjustment_reasons_select_adjuster" ON "public"."inventory_adjustment_reasons" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."has_any_inventory_capability"("inventory_adjustment_reasons"."organization_id", ARRAY['inventory.adjust.create'::"text", 'inventory.adjust.post'::"text"]) AS "has_any_inventory_capability"));

DROP POLICY IF EXISTS "inventory_adjustments_select_authorized_scope" ON "public"."inventory_adjustments";
CREATE POLICY "inventory_adjustments_select_authorized_scope" ON "public"."inventory_adjustments" FOR SELECT TO "tindio_authenticated" USING (((( SELECT "private"."has_permission"("inventory_adjustments"."organization_id", 'inventory.view'::"text") AS "has_permission") OR ( SELECT "private"."has_any_inventory_capability"("inventory_adjustments"."organization_id", ARRAY['inventory.adjust.create'::"text", 'inventory.adjust.post'::"text"]) AS "has_any_inventory_capability")) AND ( SELECT "private"."has_store_read_scope"("inventory_adjustments"."organization_id", "inventory_adjustments"."store_id") AS "has_store_read_scope")));

DROP POLICY IF EXISTS "inventory_count_batch_documents_select_authorized_scope" ON "public"."inventory_count_batch_documents";
CREATE POLICY "inventory_count_batch_documents_select_authorized_scope" ON "public"."inventory_count_batch_documents" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_any_inventory_capability"("inventory_count_batch_documents"."organization_id", ARRAY['inventory.count.create'::"text", 'inventory.count.finalize'::"text"]) AS "has_any_inventory_capability") AND (EXISTS ( SELECT 1
   FROM "public"."inventory_counts" "count_document"
  WHERE (("count_document"."id" = "inventory_count_batch_documents"."inventory_count_id") AND ("count_document"."organization_id" = "inventory_count_batch_documents"."organization_id") AND ( SELECT "private"."has_store_read_scope"("count_document"."organization_id", "count_document"."store_id") AS "has_store_read_scope"))))));

DROP POLICY IF EXISTS "inventory_count_batches_select_authorized_scope" ON "public"."inventory_count_batches";
CREATE POLICY "inventory_count_batches_select_authorized_scope" ON "public"."inventory_count_batches" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_any_inventory_capability"("inventory_count_batches"."organization_id", ARRAY['inventory.count.create'::"text", 'inventory.count.finalize'::"text"]) AS "has_any_inventory_capability") AND (EXISTS ( SELECT 1
   FROM ("public"."inventory_count_batch_documents" "batch_document"
     JOIN "public"."inventory_counts" "count_document" ON ((("count_document"."id" = "batch_document"."inventory_count_id") AND ("count_document"."organization_id" = "batch_document"."organization_id"))))
  WHERE (("batch_document"."organization_id" = "inventory_count_batches"."organization_id") AND ("batch_document"."inventory_count_batch_id" = "inventory_count_batches"."id") AND ( SELECT "private"."has_store_read_scope"("count_document"."organization_id", "count_document"."store_id") AS "has_store_read_scope"))))));

DROP POLICY IF EXISTS "inventory_count_lines_select_authorized_scope" ON "public"."inventory_count_lines";
CREATE POLICY "inventory_count_lines_select_authorized_scope" ON "public"."inventory_count_lines" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_any_inventory_capability"("inventory_count_lines"."organization_id", ARRAY['inventory.count.create'::"text", 'inventory.count.finalize'::"text"]) AS "has_any_inventory_capability") AND (EXISTS ( SELECT 1
   FROM "public"."inventory_counts" "count_document"
  WHERE (("count_document"."id" = "inventory_count_lines"."inventory_count_id") AND ("count_document"."organization_id" = "inventory_count_lines"."organization_id") AND ( SELECT "private"."has_store_read_scope"("count_document"."organization_id", "count_document"."store_id") AS "has_store_read_scope"))))));

DROP POLICY IF EXISTS "inventory_counts_select_authorized_scope" ON "public"."inventory_counts";
CREATE POLICY "inventory_counts_select_authorized_scope" ON "public"."inventory_counts" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_any_inventory_capability"("inventory_counts"."organization_id", ARRAY['inventory.count.create'::"text", 'inventory.count.finalize'::"text"]) AS "has_any_inventory_capability") AND ( SELECT "private"."has_store_read_scope"("inventory_counts"."organization_id", "inventory_counts"."store_id") AS "has_store_read_scope")));

DROP POLICY IF EXISTS "inventory_levels_select_authorized_scope" ON "public"."inventory_levels";
CREATE POLICY "inventory_levels_select_authorized_scope" ON "public"."inventory_levels" FOR SELECT TO "tindio_authenticated" USING (((( SELECT "private"."has_permission"("inventory_levels"."organization_id", 'inventory.view'::"text") AS "has_permission") OR ( SELECT "private"."has_permission"("inventory_levels"."organization_id", 'inventory.manage'::"text") AS "has_permission") OR ( SELECT "private"."has_any_inventory_capability"("inventory_levels"."organization_id", ARRAY['inventory.adjust.create'::"text", 'inventory.adjust.post'::"text", 'inventory.count.create'::"text", 'inventory.count.finalize'::"text", 'inventory.transfer.create'::"text", 'inventory.transfer.send'::"text", 'inventory.transfer.receive'::"text", 'purchasing.po.create'::"text", 'purchasing.receive'::"text", 'purchasing.return'::"text"]) AS "has_any_inventory_capability") OR (( SELECT "private"."has_permission"("inventory_levels"."organization_id", 'products.view_cost'::"text") AS "has_permission") AND ( SELECT "private"."has_inventory_capability"("inventory_levels"."organization_id", 'inventory.valuation.view'::"text") AS "has_inventory_capability"))) AND ( SELECT "private"."has_store_read_scope"("inventory_levels"."organization_id", "inventory_levels"."store_id") AS "has_store_read_scope")));

DROP POLICY IF EXISTS "inventory_movements_select_authorized" ON "public"."inventory_movements";
CREATE POLICY "inventory_movements_select_authorized" ON "public"."inventory_movements" FOR SELECT TO "tindio_authenticated" USING (((( SELECT "private"."has_permission"("inventory_movements"."organization_id", 'inventory.view'::"text") AS "has_permission") OR ( SELECT "private"."has_any_inventory_capability"("inventory_movements"."organization_id", ARRAY['inventory.adjust.create'::"text", 'inventory.adjust.post'::"text", 'inventory.count.create'::"text", 'inventory.count.finalize'::"text"]) AS "has_any_inventory_capability")) AND ( SELECT "private"."has_store_read_scope"("inventory_movements"."organization_id", "inventory_movements"."store_id") AS "has_store_read_scope")));

DROP POLICY IF EXISTS "inventory_policies_select_manager" ON "public"."inventory_policies";
CREATE POLICY "inventory_policies_select_manager" ON "public"."inventory_policies" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("inventory_policies"."organization_id", 'inventory.manage'::"text") AS "has_permission") AND ( SELECT "private"."has_store_read_scope"("inventory_policies"."organization_id", "inventory_policies"."store_id") AS "has_store_read_scope")));

DROP POLICY IF EXISTS "inventory_policy_defaults_select_inventory_manager" ON "public"."inventory_policy_defaults";
CREATE POLICY "inventory_policy_defaults_select_inventory_manager" ON "public"."inventory_policy_defaults" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("inventory_policy_defaults"."organization_id", 'inventory.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "inventory_replenishment_rules_select_inventory_manager" ON "public"."inventory_replenishment_rules";
CREATE POLICY "inventory_replenishment_rules_select_inventory_manager" ON "public"."inventory_replenishment_rules" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("inventory_replenishment_rules"."organization_id", 'inventory.manage'::"text") AS "has_permission") AND ( SELECT "private"."has_store_read_scope"("inventory_replenishment_rules"."organization_id", "inventory_replenishment_rules"."store_id") AS "has_store_read_scope")));

DROP POLICY IF EXISTS "loyalty_programs_select_sales_or_manager" ON "public"."loyalty_programs";
CREATE POLICY "loyalty_programs_select_sales_or_manager" ON "public"."loyalty_programs" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("loyalty_programs"."organization_id", 'sales.create'::"text") AS "has_permission") OR ( SELECT "private"."has_permission"("loyalty_programs"."organization_id", 'customers.manage'::"text") AS "has_permission")));

DROP POLICY IF EXISTS "loyalty_programs_update_settings_manager" ON "public"."loyalty_programs";
CREATE POLICY "loyalty_programs_update_settings_manager" ON "public"."loyalty_programs" FOR UPDATE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("loyalty_programs"."organization_id", 'settings.manage'::"text") AS "has_permission")) WITH CHECK (( SELECT "private"."has_permission"("loyalty_programs"."organization_id", 'settings.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "loyalty_transactions_select_customer_manager" ON "public"."loyalty_transactions";
CREATE POLICY "loyalty_transactions_select_customer_manager" ON "public"."loyalty_transactions" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("loyalty_transactions"."organization_id", 'customers.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "modifier_groups_insert_authorized" ON "public"."modifier_groups";
CREATE POLICY "modifier_groups_insert_authorized" ON "public"."modifier_groups" FOR INSERT TO "tindio_authenticated" WITH CHECK (( SELECT "private"."has_permission"("modifier_groups"."organization_id", 'products.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "modifier_groups_select_sales_or_manager" ON "public"."modifier_groups";
CREATE POLICY "modifier_groups_select_sales_or_manager" ON "public"."modifier_groups" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("modifier_groups"."organization_id", 'sales.create'::"text") AS "has_permission") OR ( SELECT "private"."has_permission"("modifier_groups"."organization_id", 'products.manage'::"text") AS "has_permission")));

DROP POLICY IF EXISTS "modifier_groups_update_authorized" ON "public"."modifier_groups";
CREATE POLICY "modifier_groups_update_authorized" ON "public"."modifier_groups" FOR UPDATE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("modifier_groups"."organization_id", 'products.manage'::"text") AS "has_permission")) WITH CHECK (( SELECT "private"."has_permission"("modifier_groups"."organization_id", 'products.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "modifier_options_insert_authorized" ON "public"."modifier_options";
CREATE POLICY "modifier_options_insert_authorized" ON "public"."modifier_options" FOR INSERT TO "tindio_authenticated" WITH CHECK (( SELECT "private"."has_permission"("modifier_options"."organization_id", 'products.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "modifier_options_select_sales_or_manager" ON "public"."modifier_options";
CREATE POLICY "modifier_options_select_sales_or_manager" ON "public"."modifier_options" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("modifier_options"."organization_id", 'sales.create'::"text") AS "has_permission") OR ( SELECT "private"."has_permission"("modifier_options"."organization_id", 'products.manage'::"text") AS "has_permission")));

DROP POLICY IF EXISTS "modifier_options_update_authorized" ON "public"."modifier_options";
CREATE POLICY "modifier_options_update_authorized" ON "public"."modifier_options" FOR UPDATE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("modifier_options"."organization_id", 'products.manage'::"text") AS "has_permission")) WITH CHECK (( SELECT "private"."has_permission"("modifier_options"."organization_id", 'products.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "offline_sync_events_select_device_managers" ON "public"."offline_sync_events";
CREATE POLICY "offline_sync_events_select_device_managers" ON "public"."offline_sync_events" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("offline_sync_events"."organization_id", 'devices.manage'::"text") AS "has_permission") AND ( SELECT "private"."has_store_read_scope"("offline_sync_events"."organization_id", "offline_sync_events"."store_id") AS "has_store_read_scope")));

DROP POLICY IF EXISTS "open_tickets_select_active_shift_owner" ON "public"."open_tickets";
CREATE POLICY "open_tickets_select_active_shift_owner" ON "public"."open_tickets" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."has_active_pos_shift_access"("open_tickets"."organization_id", "open_tickets"."store_id", "open_tickets"."register_id") AS "has_active_pos_shift_access"));

DROP POLICY IF EXISTS "organization_features_select_member" ON "public"."organization_features";
CREATE POLICY "organization_features_select_member" ON "public"."organization_features" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."is_organization_member"("organization_features"."organization_id") AS "is_organization_member"));

DROP POLICY IF EXISTS "organizations_insert_authenticated" ON "public"."organizations";
CREATE POLICY "organizations_insert_authenticated" ON "public"."organizations" FOR INSERT TO "tindio_authenticated" WITH CHECK (("created_by" = ( SELECT "public"."current_profile_id"() AS "uid")));

DROP POLICY IF EXISTS "organizations_select_member" ON "public"."organizations";
CREATE POLICY "organizations_select_member" ON "public"."organizations" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_organization_membership"("organizations"."id") AS "has_organization_membership") OR ("created_by" = ( SELECT "public"."current_profile_id"() AS "uid"))));

DROP POLICY IF EXISTS "organizations_update_authorized" ON "public"."organizations";
CREATE POLICY "organizations_update_authorized" ON "public"."organizations" FOR UPDATE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("organizations"."id", 'organization.manage'::"text") AS "has_permission")) WITH CHECK (( SELECT "private"."has_permission"("organizations"."id", 'organization.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "payment_methods_insert_settings_manager" ON "public"."payment_methods";
CREATE POLICY "payment_methods_insert_settings_manager" ON "public"."payment_methods" FOR INSERT TO "tindio_authenticated" WITH CHECK (( SELECT "private"."has_permission"("payment_methods"."organization_id", 'settings.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "payment_methods_select_member" ON "public"."payment_methods";
CREATE POLICY "payment_methods_select_member" ON "public"."payment_methods" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."is_organization_member"("payment_methods"."organization_id") AS "is_organization_member"));

DROP POLICY IF EXISTS "payment_methods_update_settings_manager" ON "public"."payment_methods";
CREATE POLICY "payment_methods_update_settings_manager" ON "public"."payment_methods" FOR UPDATE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("payment_methods"."organization_id", 'settings.manage'::"text") AS "has_permission")) WITH CHECK (( SELECT "private"."has_permission"("payment_methods"."organization_id", 'settings.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "payments_select_receipts_authorized" ON "public"."payments";
CREATE POLICY "payments_select_receipts_authorized" ON "public"."payments" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("payments"."organization_id", 'receipts.view'::"text") AS "has_permission") AND ( SELECT "private"."has_sale_read_scope"("payments"."organization_id", "payments"."sale_id") AS "has_sale_read_scope")));

DROP POLICY IF EXISTS "permissions_select_authenticated" ON "public"."permissions";
CREATE POLICY "permissions_select_authenticated" ON "public"."permissions" FOR SELECT TO "tindio_authenticated" USING (true);

DROP POLICY IF EXISTS "pos_device_sync_telemetry_manager_select" ON "public"."pos_device_sync_telemetry";
CREATE POLICY "pos_device_sync_telemetry_manager_select" ON "public"."pos_device_sync_telemetry" FOR SELECT TO "tindio_authenticated" USING ((("private"."current_employee_id"("organization_id") IS NOT NULL) AND "private"."has_permission"("organization_id", 'devices.manage'::"text")));

DROP POLICY IF EXISTS "pos_devices_select_managers" ON "public"."pos_devices";
CREATE POLICY "pos_devices_select_managers" ON "public"."pos_devices" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("pos_devices"."organization_id", 'devices.manage'::"text") AS "has_permission") AND ( SELECT "private"."has_store_read_scope"("pos_devices"."organization_id", "pos_devices"."store_id") AS "has_store_read_scope")));

DROP POLICY IF EXISTS "pos_favorite_tiles_delete_catalog_users" ON "public"."pos_favorite_tiles";
CREATE POLICY "pos_favorite_tiles_delete_catalog_users" ON "public"."pos_favorite_tiles" FOR DELETE TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("pos_favorite_tiles"."organization_id", 'products.manage'::"text") AS "has_permission") AND (EXISTS ( SELECT 1
   FROM ("public"."employees" "employee"
     JOIN "public"."employee_stores" "employee_store" ON ((("employee_store"."employee_id" = "employee"."id") AND ("employee_store"."organization_id" = "employee"."organization_id"))))
  WHERE (("employee"."organization_id" = "pos_favorite_tiles"."organization_id") AND ("employee"."profile_id" = ( SELECT "public"."current_profile_id"() AS "uid")) AND ("employee"."status" = 'active'::"text") AND ("employee_store"."store_id" = "pos_favorite_tiles"."store_id"))))));

DROP POLICY IF EXISTS "pos_favorite_tiles_insert_catalog_users" ON "public"."pos_favorite_tiles";
CREATE POLICY "pos_favorite_tiles_insert_catalog_users" ON "public"."pos_favorite_tiles" FOR INSERT TO "tindio_authenticated" WITH CHECK ((( SELECT "private"."has_permission"("pos_favorite_tiles"."organization_id", 'products.manage'::"text") AS "has_permission") AND (EXISTS ( SELECT 1
   FROM ("public"."employees" "employee"
     JOIN "public"."employee_stores" "employee_store" ON ((("employee_store"."employee_id" = "employee"."id") AND ("employee_store"."organization_id" = "employee"."organization_id"))))
  WHERE (("employee"."organization_id" = "pos_favorite_tiles"."organization_id") AND ("employee"."profile_id" = ( SELECT "public"."current_profile_id"() AS "uid")) AND ("employee"."status" = 'active'::"text") AND ("employee_store"."store_id" = "pos_favorite_tiles"."store_id"))))));

DROP POLICY IF EXISTS "pos_favorite_tiles_select_pos_users" ON "public"."pos_favorite_tiles";
CREATE POLICY "pos_favorite_tiles_select_pos_users" ON "public"."pos_favorite_tiles" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("pos_favorite_tiles"."organization_id", 'sales.create'::"text") AS "has_permission") AND (EXISTS ( SELECT 1
   FROM ("public"."employees" "employee"
     JOIN "public"."employee_stores" "employee_store" ON ((("employee_store"."employee_id" = "employee"."id") AND ("employee_store"."organization_id" = "employee"."organization_id"))))
  WHERE (("employee"."organization_id" = "pos_favorite_tiles"."organization_id") AND ("employee"."profile_id" = ( SELECT "public"."current_profile_id"() AS "uid")) AND ("employee"."status" = 'active'::"text") AND ("employee_store"."store_id" = "pos_favorite_tiles"."store_id"))))));

DROP POLICY IF EXISTS "pos_favorite_tiles_update_catalog_users" ON "public"."pos_favorite_tiles";
CREATE POLICY "pos_favorite_tiles_update_catalog_users" ON "public"."pos_favorite_tiles" FOR UPDATE TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("pos_favorite_tiles"."organization_id", 'products.manage'::"text") AS "has_permission") AND (EXISTS ( SELECT 1
   FROM ("public"."employees" "employee"
     JOIN "public"."employee_stores" "employee_store" ON ((("employee_store"."employee_id" = "employee"."id") AND ("employee_store"."organization_id" = "employee"."organization_id"))))
  WHERE (("employee"."organization_id" = "pos_favorite_tiles"."organization_id") AND ("employee"."profile_id" = ( SELECT "public"."current_profile_id"() AS "uid")) AND ("employee"."status" = 'active'::"text") AND ("employee_store"."store_id" = "pos_favorite_tiles"."store_id")))))) WITH CHECK ((( SELECT "private"."has_permission"("pos_favorite_tiles"."organization_id", 'products.manage'::"text") AS "has_permission") AND (EXISTS ( SELECT 1
   FROM ("public"."employees" "employee"
     JOIN "public"."employee_stores" "employee_store" ON ((("employee_store"."employee_id" = "employee"."id") AND ("employee_store"."organization_id" = "employee"."organization_id"))))
  WHERE (("employee"."organization_id" = "pos_favorite_tiles"."organization_id") AND ("employee"."profile_id" = ( SELECT "public"."current_profile_id"() AS "uid")) AND ("employee"."status" = 'active'::"text") AND ("employee_store"."store_id" = "pos_favorite_tiles"."store_id"))))));

DROP POLICY IF EXISTS "product_modifier_groups_insert_authorized" ON "public"."product_modifier_groups";
CREATE POLICY "product_modifier_groups_insert_authorized" ON "public"."product_modifier_groups" FOR INSERT TO "tindio_authenticated" WITH CHECK (( SELECT "private"."has_permission"("product_modifier_groups"."organization_id", 'products.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "product_modifier_groups_select_sales_or_manager" ON "public"."product_modifier_groups";
CREATE POLICY "product_modifier_groups_select_sales_or_manager" ON "public"."product_modifier_groups" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("product_modifier_groups"."organization_id", 'sales.create'::"text") AS "has_permission") OR ( SELECT "private"."has_permission"("product_modifier_groups"."organization_id", 'products.manage'::"text") AS "has_permission")));

DROP POLICY IF EXISTS "product_modifier_groups_update_authorized" ON "public"."product_modifier_groups";
CREATE POLICY "product_modifier_groups_update_authorized" ON "public"."product_modifier_groups" FOR UPDATE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("product_modifier_groups"."organization_id", 'products.manage'::"text") AS "has_permission")) WITH CHECK (( SELECT "private"."has_permission"("product_modifier_groups"."organization_id", 'products.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "product_store_settings_insert_authorized" ON "public"."product_store_settings";
CREATE POLICY "product_store_settings_insert_authorized" ON "public"."product_store_settings" FOR INSERT TO "tindio_authenticated" WITH CHECK ((( SELECT "private"."has_permission"("product_store_settings"."organization_id", 'products.manage'::"text") AS "has_permission") AND ( SELECT "private"."has_store_read_scope"("product_store_settings"."organization_id", "product_store_settings"."store_id") AS "has_store_read_scope")));

DROP POLICY IF EXISTS "product_store_settings_select_authorized_scope" ON "public"."product_store_settings";
CREATE POLICY "product_store_settings_select_authorized_scope" ON "public"."product_store_settings" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."is_organization_member"("product_store_settings"."organization_id") AS "is_organization_member") AND ( SELECT "private"."has_store_read_scope"("product_store_settings"."organization_id", "product_store_settings"."store_id") AS "has_store_read_scope")));

DROP POLICY IF EXISTS "product_store_settings_update_authorized" ON "public"."product_store_settings";
CREATE POLICY "product_store_settings_update_authorized" ON "public"."product_store_settings" FOR UPDATE TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("product_store_settings"."organization_id", 'products.manage'::"text") AS "has_permission") AND ( SELECT "private"."has_store_read_scope"("product_store_settings"."organization_id", "product_store_settings"."store_id") AS "has_store_read_scope"))) WITH CHECK ((( SELECT "private"."has_permission"("product_store_settings"."organization_id", 'products.manage'::"text") AS "has_permission") AND ( SELECT "private"."has_store_read_scope"("product_store_settings"."organization_id", "product_store_settings"."store_id") AS "has_store_read_scope")));

DROP POLICY IF EXISTS "product_variants_select_member" ON "public"."product_variants";
CREATE POLICY "product_variants_select_member" ON "public"."product_variants" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."is_organization_member"("product_variants"."organization_id") AS "is_organization_member"));

DROP POLICY IF EXISTS "product_variants_update_authorized" ON "public"."product_variants";
CREATE POLICY "product_variants_update_authorized" ON "public"."product_variants" FOR UPDATE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("product_variants"."organization_id", 'products.manage'::"text") AS "has_permission")) WITH CHECK (( SELECT "private"."has_permission"("product_variants"."organization_id", 'products.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "production_run_components_select_authorized_scope" ON "public"."production_run_components";
CREATE POLICY "production_run_components_select_authorized_scope" ON "public"."production_run_components" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("production_run_components"."organization_id", 'inventory.manage'::"text") AS "has_permission") AND (EXISTS ( SELECT 1
   FROM "public"."production_runs" "production_run"
  WHERE (("production_run"."id" = "production_run_components"."production_run_id") AND ("production_run"."organization_id" = "production_run_components"."organization_id") AND ( SELECT "private"."has_store_read_scope"("production_run"."organization_id", "production_run"."store_id") AS "has_store_read_scope"))))));

DROP POLICY IF EXISTS "production_runs_select_authorized_scope" ON "public"."production_runs";
CREATE POLICY "production_runs_select_authorized_scope" ON "public"."production_runs" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("production_runs"."organization_id", 'inventory.manage'::"text") AS "has_permission") AND ( SELECT "private"."has_store_read_scope"("production_runs"."organization_id", "production_runs"."store_id") AS "has_store_read_scope")));

DROP POLICY IF EXISTS "products_select_member" ON "public"."products";
CREATE POLICY "products_select_member" ON "public"."products" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."is_organization_member"("products"."organization_id") AS "is_organization_member"));

DROP POLICY IF EXISTS "products_update_authorized" ON "public"."products";
CREATE POLICY "products_update_authorized" ON "public"."products" FOR UPDATE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("products"."organization_id", 'products.manage'::"text") AS "has_permission")) WITH CHECK (( SELECT "private"."has_permission"("products"."organization_id", 'products.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "profiles_select_authorized" ON "public"."profiles";
CREATE POLICY "profiles_select_authorized" ON "public"."profiles" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."can_view_employee_profile"("profiles"."id") AS "can_view_employee_profile"));

DROP POLICY IF EXISTS "profiles_update_own" ON "public"."profiles";
CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE TO "tindio_authenticated" USING (("id" = ( SELECT "public"."current_profile_id"() AS "uid"))) WITH CHECK (("id" = ( SELECT "public"."current_profile_id"() AS "uid")));

DROP POLICY IF EXISTS "purchase_order_lines_select_purchasing_scope" ON "public"."purchase_order_lines";
CREATE POLICY "purchase_order_lines_select_purchasing_scope" ON "public"."purchase_order_lines" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_any_inventory_capability"("purchase_order_lines"."organization_id", ARRAY['purchasing.view'::"text", 'purchasing.po.create'::"text", 'purchasing.receive'::"text"]) AS "has_any_inventory_capability") AND ( SELECT "private"."has_purchase_order_read_scope"("purchase_order_lines"."organization_id", "purchase_order_lines"."purchase_order_id") AS "has_purchase_order_read_scope")));

DROP POLICY IF EXISTS "purchase_orders_select_purchasing_scope" ON "public"."purchase_orders";
CREATE POLICY "purchase_orders_select_purchasing_scope" ON "public"."purchase_orders" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_any_inventory_capability"("purchase_orders"."organization_id", ARRAY['purchasing.view'::"text", 'purchasing.po.create'::"text", 'purchasing.receive'::"text"]) AS "has_any_inventory_capability") AND ( SELECT "private"."has_store_read_scope"("purchase_orders"."organization_id", "purchase_orders"."store_id") AS "has_store_read_scope")));

DROP POLICY IF EXISTS "receipt_delivery_requests_select_reprint_authorized" ON "public"."receipt_delivery_requests";
CREATE POLICY "receipt_delivery_requests_select_reprint_authorized" ON "public"."receipt_delivery_requests" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("receipt_delivery_requests"."organization_id", 'receipts.reprint'::"text") AS "has_permission") AND (EXISTS ( SELECT 1
   FROM "public"."receipts" "receipt"
  WHERE (("receipt"."id" = "receipt_delivery_requests"."receipt_id") AND ("receipt"."organization_id" = "receipt_delivery_requests"."organization_id") AND ( SELECT "private"."has_sale_read_scope"("receipt"."organization_id", "receipt"."sale_id") AS "has_sale_read_scope"))))));

DROP POLICY IF EXISTS "receipt_settings_select_settings_manager" ON "public"."receipt_settings";
CREATE POLICY "receipt_settings_select_settings_manager" ON "public"."receipt_settings" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("receipt_settings"."organization_id", 'settings.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "receipts_select_receipts_authorized" ON "public"."receipts";
CREATE POLICY "receipts_select_receipts_authorized" ON "public"."receipts" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("receipts"."organization_id", 'receipts.view'::"text") AS "has_permission") AND ( SELECT "private"."has_sale_read_scope"("receipts"."organization_id", "receipts"."sale_id") AS "has_sale_read_scope")));

DROP POLICY IF EXISTS "refund_items_select_receipts_authorized" ON "public"."refund_items";
CREATE POLICY "refund_items_select_receipts_authorized" ON "public"."refund_items" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("refund_items"."organization_id", 'receipts.view'::"text") AS "has_permission") AND ( SELECT "private"."has_refund_read_scope"("refund_items"."organization_id", "refund_items"."refund_id") AS "has_refund_read_scope")));

DROP POLICY IF EXISTS "refund_payments_select_receipts_authorized" ON "public"."refund_payments";
CREATE POLICY "refund_payments_select_receipts_authorized" ON "public"."refund_payments" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("refund_payments"."organization_id", 'receipts.view'::"text") AS "has_permission") AND ( SELECT "private"."has_refund_read_scope"("refund_payments"."organization_id", "refund_payments"."refund_id") AS "has_refund_read_scope")));

DROP POLICY IF EXISTS "refunds_select_receipts_authorized" ON "public"."refunds";
CREATE POLICY "refunds_select_receipts_authorized" ON "public"."refunds" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("refunds"."organization_id", 'receipts.view'::"text") AS "has_permission") AND ( SELECT "private"."has_store_read_scope"("refunds"."organization_id", "refunds"."store_id") AS "has_store_read_scope")));

DROP POLICY IF EXISTS "registers_insert_authorized" ON "public"."registers";
CREATE POLICY "registers_insert_authorized" ON "public"."registers" FOR INSERT TO "tindio_authenticated" WITH CHECK ((( SELECT "private"."is_organization_creator"("registers"."organization_id") AS "is_organization_creator") OR ( SELECT "private"."has_permission"("registers"."organization_id", 'registers.manage'::"text") AS "has_permission")));

DROP POLICY IF EXISTS "registers_select_authorized_scope" ON "public"."registers";
CREATE POLICY "registers_select_authorized_scope" ON "public"."registers" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."is_organization_creator"("registers"."organization_id") AS "is_organization_creator") OR ( SELECT "private"."has_store_read_scope"("registers"."organization_id", "registers"."store_id") AS "has_store_read_scope")));

DROP POLICY IF EXISTS "registers_update_authorized" ON "public"."registers";
CREATE POLICY "registers_update_authorized" ON "public"."registers" FOR UPDATE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("registers"."organization_id", 'registers.manage'::"text") AS "has_permission")) WITH CHECK (( SELECT "private"."has_permission"("registers"."organization_id", 'registers.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "role_permissions_delete_authorized" ON "public"."role_permissions";
CREATE POLICY "role_permissions_delete_authorized" ON "public"."role_permissions" FOR DELETE TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("role_permissions"."organization_id", 'roles.manage'::"text") AS "has_permission") AND ( SELECT "private"."can_grant_role"("role_permissions"."organization_id", "role_permissions"."role_id") AS "can_grant_role") AND (EXISTS ( SELECT 1
   FROM "public"."roles" "role"
  WHERE (("role"."id" = "role_permissions"."role_id") AND ("role"."organization_id" = "role_permissions"."organization_id") AND (NOT "role"."is_system"))))));

DROP POLICY IF EXISTS "role_permissions_insert_authorized" ON "public"."role_permissions";
CREATE POLICY "role_permissions_insert_authorized" ON "public"."role_permissions" FOR INSERT TO "tindio_authenticated" WITH CHECK ((( SELECT "private"."is_organization_creator"("role_permissions"."organization_id") AS "is_organization_creator") OR (( SELECT "private"."has_permission"("role_permissions"."organization_id", 'roles.manage'::"text") AS "has_permission") AND ( SELECT "private"."has_permission"("role_permissions"."organization_id", "role_permissions"."permission_code") AS "has_permission") AND (EXISTS ( SELECT 1
   FROM "public"."roles" "role"
  WHERE (("role"."id" = "role_permissions"."role_id") AND ("role"."organization_id" = "role_permissions"."organization_id") AND (NOT "role"."is_system")))))));

DROP POLICY IF EXISTS "role_permissions_select_member" ON "public"."role_permissions";
CREATE POLICY "role_permissions_select_member" ON "public"."role_permissions" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."is_organization_member"("role_permissions"."organization_id") AS "is_organization_member"));

DROP POLICY IF EXISTS "roles_insert_authorized" ON "public"."roles";
CREATE POLICY "roles_insert_authorized" ON "public"."roles" FOR INSERT TO "tindio_authenticated" WITH CHECK ((( SELECT "private"."is_organization_creator"("roles"."organization_id") AS "is_organization_creator") OR ( SELECT "private"."has_permission"("roles"."organization_id", 'roles.manage'::"text") AS "has_permission")));

DROP POLICY IF EXISTS "roles_select_member" ON "public"."roles";
CREATE POLICY "roles_select_member" ON "public"."roles" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."is_organization_member"("roles"."organization_id") AS "is_organization_member") OR ( SELECT "private"."is_organization_creator"("roles"."organization_id") AS "is_organization_creator")));

DROP POLICY IF EXISTS "roles_update_authorized" ON "public"."roles";
CREATE POLICY "roles_update_authorized" ON "public"."roles" FOR UPDATE TO "tindio_authenticated" USING (((NOT "is_system") AND ( SELECT "private"."has_permission"("roles"."organization_id", 'roles.manage'::"text") AS "has_permission"))) WITH CHECK (((NOT "is_system") AND ( SELECT "private"."has_permission"("roles"."organization_id", 'roles.manage'::"text") AS "has_permission")));

DROP POLICY IF EXISTS "sale_exchanges_select_receipts_authorized" ON "public"."sale_exchanges";
CREATE POLICY "sale_exchanges_select_receipts_authorized" ON "public"."sale_exchanges" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("sale_exchanges"."organization_id", 'receipts.view'::"text") AS "has_permission") AND ( SELECT "private"."has_refund_read_scope"("sale_exchanges"."organization_id", "sale_exchanges"."refund_id") AS "has_refund_read_scope")));

DROP POLICY IF EXISTS "sale_items_select_receipts_authorized" ON "public"."sale_items";
CREATE POLICY "sale_items_select_receipts_authorized" ON "public"."sale_items" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("sale_items"."organization_id", 'receipts.view'::"text") AS "has_permission") AND ( SELECT "private"."has_sale_read_scope"("sale_items"."organization_id", "sale_items"."sale_id") AS "has_sale_read_scope")));

DROP POLICY IF EXISTS "sales_select_receipts_authorized" ON "public"."sales";
CREATE POLICY "sales_select_receipts_authorized" ON "public"."sales" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("sales"."organization_id", 'receipts.view'::"text") AS "has_permission") AND ( SELECT "private"."has_store_read_scope"("sales"."organization_id", "sales"."store_id") AS "has_store_read_scope")));

DROP POLICY IF EXISTS "shifts_select_authorized" ON "public"."shifts";
CREATE POLICY "shifts_select_authorized" ON "public"."shifts" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."has_shift_access"("shifts"."organization_id", "shifts"."store_id") AS "has_shift_access"));

DROP POLICY IF EXISTS "smart_menu_categories_delete_settings_manager" ON "public"."smart_menu_categories";
CREATE POLICY "smart_menu_categories_delete_settings_manager" ON "public"."smart_menu_categories" FOR DELETE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("smart_menu_categories"."organization_id", 'settings.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "smart_menu_categories_insert_settings_manager" ON "public"."smart_menu_categories";
CREATE POLICY "smart_menu_categories_insert_settings_manager" ON "public"."smart_menu_categories" FOR INSERT TO "tindio_authenticated" WITH CHECK (( SELECT "private"."has_permission"("smart_menu_categories"."organization_id", 'settings.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "smart_menu_categories_select_member" ON "public"."smart_menu_categories";
CREATE POLICY "smart_menu_categories_select_member" ON "public"."smart_menu_categories" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."is_organization_member"("smart_menu_categories"."organization_id") AS "is_organization_member"));

DROP POLICY IF EXISTS "smart_menu_categories_update_settings_manager" ON "public"."smart_menu_categories";
CREATE POLICY "smart_menu_categories_update_settings_manager" ON "public"."smart_menu_categories" FOR UPDATE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("smart_menu_categories"."organization_id", 'settings.manage'::"text") AS "has_permission")) WITH CHECK (( SELECT "private"."has_permission"("smart_menu_categories"."organization_id", 'settings.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "smart_menu_products_delete_settings_manager" ON "public"."smart_menu_products";
CREATE POLICY "smart_menu_products_delete_settings_manager" ON "public"."smart_menu_products" FOR DELETE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("smart_menu_products"."organization_id", 'settings.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "smart_menu_products_insert_settings_manager" ON "public"."smart_menu_products";
CREATE POLICY "smart_menu_products_insert_settings_manager" ON "public"."smart_menu_products" FOR INSERT TO "tindio_authenticated" WITH CHECK (( SELECT "private"."has_permission"("smart_menu_products"."organization_id", 'settings.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "smart_menu_products_select_member" ON "public"."smart_menu_products";
CREATE POLICY "smart_menu_products_select_member" ON "public"."smart_menu_products" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."is_organization_member"("smart_menu_products"."organization_id") AS "is_organization_member"));

DROP POLICY IF EXISTS "smart_menu_products_update_settings_manager" ON "public"."smart_menu_products";
CREATE POLICY "smart_menu_products_update_settings_manager" ON "public"."smart_menu_products" FOR UPDATE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("smart_menu_products"."organization_id", 'settings.manage'::"text") AS "has_permission")) WITH CHECK (( SELECT "private"."has_permission"("smart_menu_products"."organization_id", 'settings.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "smart_menus_delete_settings_manager" ON "public"."smart_menus";
CREATE POLICY "smart_menus_delete_settings_manager" ON "public"."smart_menus" FOR DELETE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("smart_menus"."organization_id", 'settings.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "smart_menus_insert_settings_manager" ON "public"."smart_menus";
CREATE POLICY "smart_menus_insert_settings_manager" ON "public"."smart_menus" FOR INSERT TO "tindio_authenticated" WITH CHECK (( SELECT "private"."has_permission"("smart_menus"."organization_id", 'settings.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "smart_menus_select_member" ON "public"."smart_menus";
CREATE POLICY "smart_menus_select_member" ON "public"."smart_menus" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."is_organization_member"("smart_menus"."organization_id") AS "is_organization_member"));

DROP POLICY IF EXISTS "smart_menus_update_settings_manager" ON "public"."smart_menus";
CREATE POLICY "smart_menus_update_settings_manager" ON "public"."smart_menus" FOR UPDATE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("smart_menus"."organization_id", 'settings.manage'::"text") AS "has_permission")) WITH CHECK (( SELECT "private"."has_permission"("smart_menus"."organization_id", 'settings.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "stock_request_discrepancies_select_inventory_transfer_scope" ON "public"."stock_request_discrepancies";
CREATE POLICY "stock_request_discrepancies_select_inventory_transfer_scope" ON "public"."stock_request_discrepancies" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_any_inventory_capability"("stock_request_discrepancies"."organization_id", ARRAY['inventory.transfer.create'::"text", 'inventory.transfer.send'::"text", 'inventory.transfer.receive'::"text"]) AS "has_any_inventory_capability") AND ( SELECT "private"."has_stock_request_read_scope"("stock_request_discrepancies"."organization_id", "stock_request_discrepancies"."stock_request_id") AS "has_stock_request_read_scope")));

DROP POLICY IF EXISTS "stock_request_lines_select_inventory_transfer_scope" ON "public"."stock_request_lines";
CREATE POLICY "stock_request_lines_select_inventory_transfer_scope" ON "public"."stock_request_lines" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_any_inventory_capability"("stock_request_lines"."organization_id", ARRAY['inventory.transfer.create'::"text", 'inventory.transfer.send'::"text", 'inventory.transfer.receive'::"text"]) AS "has_any_inventory_capability") AND ( SELECT "private"."has_stock_request_read_scope"("stock_request_lines"."organization_id", "stock_request_lines"."stock_request_id") AS "has_stock_request_read_scope")));

DROP POLICY IF EXISTS "stock_requests_select_inventory_transfer_scope" ON "public"."stock_requests";
CREATE POLICY "stock_requests_select_inventory_transfer_scope" ON "public"."stock_requests" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_any_inventory_capability"("stock_requests"."organization_id", ARRAY['inventory.transfer.create'::"text", 'inventory.transfer.send'::"text", 'inventory.transfer.receive'::"text"]) AS "has_any_inventory_capability") AND ( SELECT "private"."has_stock_request_read_scope"("stock_requests"."organization_id", "stock_requests"."id") AS "has_stock_request_read_scope")));

DROP POLICY IF EXISTS "stock_transfer_lines_select_inventory_transfer_scope" ON "public"."stock_transfer_lines";
CREATE POLICY "stock_transfer_lines_select_inventory_transfer_scope" ON "public"."stock_transfer_lines" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_any_inventory_capability"("stock_transfer_lines"."organization_id", ARRAY['inventory.transfer.create'::"text", 'inventory.transfer.send'::"text", 'inventory.transfer.receive'::"text"]) AS "has_any_inventory_capability") AND ( SELECT "private"."has_stock_transfer_read_scope"("stock_transfer_lines"."organization_id", "stock_transfer_lines"."stock_transfer_id") AS "has_stock_transfer_read_scope")));

DROP POLICY IF EXISTS "stock_transfer_receipt_lines_select_inventory_transfer_scope" ON "public"."stock_transfer_receipt_lines";
CREATE POLICY "stock_transfer_receipt_lines_select_inventory_transfer_scope" ON "public"."stock_transfer_receipt_lines" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_any_inventory_capability"("stock_transfer_receipt_lines"."organization_id", ARRAY['inventory.transfer.create'::"text", 'inventory.transfer.send'::"text", 'inventory.transfer.receive'::"text"]) AS "has_any_inventory_capability") AND (EXISTS ( SELECT 1
   FROM "public"."stock_transfer_receipts" "receipt"
  WHERE (("receipt"."id" = "stock_transfer_receipt_lines"."stock_transfer_receipt_id") AND ("receipt"."organization_id" = "stock_transfer_receipt_lines"."organization_id") AND ( SELECT "private"."has_stock_transfer_read_scope"("receipt"."organization_id", "receipt"."stock_transfer_id") AS "has_stock_transfer_read_scope"))))));

DROP POLICY IF EXISTS "stock_transfer_receipts_select_inventory_transfer_scope" ON "public"."stock_transfer_receipts";
CREATE POLICY "stock_transfer_receipts_select_inventory_transfer_scope" ON "public"."stock_transfer_receipts" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_any_inventory_capability"("stock_transfer_receipts"."organization_id", ARRAY['inventory.transfer.create'::"text", 'inventory.transfer.send'::"text", 'inventory.transfer.receive'::"text"]) AS "has_any_inventory_capability") AND ( SELECT "private"."has_stock_transfer_read_scope"("stock_transfer_receipts"."organization_id", "stock_transfer_receipts"."stock_transfer_id") AS "has_stock_transfer_read_scope")));

DROP POLICY IF EXISTS "stock_transfers_select_inventory_transfer_scope" ON "public"."stock_transfers";
CREATE POLICY "stock_transfers_select_inventory_transfer_scope" ON "public"."stock_transfers" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_any_inventory_capability"("stock_transfers"."organization_id", ARRAY['inventory.transfer.create'::"text", 'inventory.transfer.send'::"text", 'inventory.transfer.receive'::"text"]) AS "has_any_inventory_capability") AND ( SELECT "private"."has_stock_transfer_read_scope"("stock_transfers"."organization_id", "stock_transfers"."id") AS "has_stock_transfer_read_scope")));

DROP POLICY IF EXISTS "store_payment_methods_insert_settings_manager" ON "public"."store_payment_methods";
CREATE POLICY "store_payment_methods_insert_settings_manager" ON "public"."store_payment_methods" FOR INSERT TO "tindio_authenticated" WITH CHECK (( SELECT "private"."has_permission"("store_payment_methods"."organization_id", 'settings.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "store_payment_methods_select_assigned_or_manager" ON "public"."store_payment_methods";
CREATE POLICY "store_payment_methods_select_assigned_or_manager" ON "public"."store_payment_methods" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("store_payment_methods"."organization_id", 'settings.manage'::"text") AS "has_permission") OR (EXISTS ( SELECT 1
   FROM ("public"."employees" "employee"
     JOIN "public"."employee_stores" "employee_store" ON ((("employee_store"."employee_id" = "employee"."id") AND ("employee_store"."organization_id" = "employee"."organization_id"))))
  WHERE (("employee"."organization_id" = "store_payment_methods"."organization_id") AND ("employee_store"."store_id" = "store_payment_methods"."store_id") AND ("employee"."profile_id" = ( SELECT "public"."current_profile_id"() AS "uid")) AND ("employee"."status" = 'active'::"text"))))));

DROP POLICY IF EXISTS "store_payment_methods_update_settings_manager" ON "public"."store_payment_methods";
CREATE POLICY "store_payment_methods_update_settings_manager" ON "public"."store_payment_methods" FOR UPDATE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("store_payment_methods"."organization_id", 'settings.manage'::"text") AS "has_permission")) WITH CHECK (( SELECT "private"."has_permission"("store_payment_methods"."organization_id", 'settings.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "stores_insert_authorized" ON "public"."stores";
CREATE POLICY "stores_insert_authorized" ON "public"."stores" FOR INSERT TO "tindio_authenticated" WITH CHECK ((( SELECT "private"."is_organization_creator"("stores"."organization_id") AS "is_organization_creator") OR ( SELECT "private"."has_permission"("stores"."organization_id", 'stores.manage'::"text") AS "has_permission")));

DROP POLICY IF EXISTS "stores_select_authorized_scope" ON "public"."stores";
CREATE POLICY "stores_select_authorized_scope" ON "public"."stores" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."is_organization_creator"("stores"."organization_id") AS "is_organization_creator") OR ( SELECT "private"."has_store_read_scope"("stores"."organization_id", "stores"."id") AS "has_store_read_scope")));

DROP POLICY IF EXISTS "stores_update_authorized" ON "public"."stores";
CREATE POLICY "stores_update_authorized" ON "public"."stores" FOR UPDATE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("stores"."organization_id", 'stores.manage'::"text") AS "has_permission")) WITH CHECK (( SELECT "private"."has_permission"("stores"."organization_id", 'stores.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "supplier_return_lines_select_purchasing_scope" ON "public"."supplier_return_lines";
CREATE POLICY "supplier_return_lines_select_purchasing_scope" ON "public"."supplier_return_lines" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_any_inventory_capability"("supplier_return_lines"."organization_id", ARRAY['purchasing.view'::"text", 'purchasing.return'::"text"]) AS "has_any_inventory_capability") AND (EXISTS ( SELECT 1
   FROM "public"."supplier_returns" "supplier_return"
  WHERE (("supplier_return"."id" = "supplier_return_lines"."supplier_return_id") AND ("supplier_return"."organization_id" = "supplier_return_lines"."organization_id") AND ( SELECT "private"."has_store_read_scope"("supplier_return"."organization_id", "supplier_return"."store_id") AS "has_store_read_scope"))))));

DROP POLICY IF EXISTS "supplier_returns_select_purchasing_scope" ON "public"."supplier_returns";
CREATE POLICY "supplier_returns_select_purchasing_scope" ON "public"."supplier_returns" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_any_inventory_capability"("supplier_returns"."organization_id", ARRAY['purchasing.view'::"text", 'purchasing.return'::"text"]) AS "has_any_inventory_capability") AND ( SELECT "private"."has_store_read_scope"("supplier_returns"."organization_id", "supplier_returns"."store_id") AS "has_store_read_scope")));

DROP POLICY IF EXISTS "suppliers_select_purchasing_scope" ON "public"."suppliers";
CREATE POLICY "suppliers_select_purchasing_scope" ON "public"."suppliers" FOR SELECT TO "tindio_authenticated" USING (( SELECT "private"."has_any_inventory_capability"("suppliers"."organization_id", ARRAY['purchasing.view'::"text", 'purchasing.po.create'::"text", 'purchasing.receive'::"text", 'purchasing.suppliers.manage'::"text", 'purchasing.return'::"text"]) AS "has_any_inventory_capability"));

DROP POLICY IF EXISTS "supply_chain_warehouses_select_inventory_transfer_scope" ON "public"."supply_chain_warehouses";
CREATE POLICY "supply_chain_warehouses_select_inventory_transfer_scope" ON "public"."supply_chain_warehouses" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_any_inventory_capability"("supply_chain_warehouses"."organization_id", ARRAY['inventory.transfer.create'::"text", 'inventory.transfer.send'::"text"]) AS "has_any_inventory_capability") AND ( SELECT "private"."has_store_read_scope"("supply_chain_warehouses"."organization_id", "supply_chain_warehouses"."store_id") AS "has_store_read_scope")));

DROP POLICY IF EXISTS "tax_rates_insert_authorized" ON "public"."tax_rates";
CREATE POLICY "tax_rates_insert_authorized" ON "public"."tax_rates" FOR INSERT TO "tindio_authenticated" WITH CHECK (( SELECT "private"."has_permission"("tax_rates"."organization_id", 'products.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "tax_rates_select_sales_or_manager" ON "public"."tax_rates";
CREATE POLICY "tax_rates_select_sales_or_manager" ON "public"."tax_rates" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("tax_rates"."organization_id", 'sales.create'::"text") AS "has_permission") OR ( SELECT "private"."has_permission"("tax_rates"."organization_id", 'products.manage'::"text") AS "has_permission")));

DROP POLICY IF EXISTS "tax_rates_update_authorized" ON "public"."tax_rates";
CREATE POLICY "tax_rates_update_authorized" ON "public"."tax_rates" FOR UPDATE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("tax_rates"."organization_id", 'products.manage'::"text") AS "has_permission")) WITH CHECK (( SELECT "private"."has_permission"("tax_rates"."organization_id", 'products.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "ticket_templates_insert_manager" ON "public"."ticket_templates";
CREATE POLICY "ticket_templates_insert_manager" ON "public"."ticket_templates" FOR INSERT TO "tindio_authenticated" WITH CHECK (( SELECT "private"."has_permission"("ticket_templates"."organization_id", 'products.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "ticket_templates_select_sales_or_manager" ON "public"."ticket_templates";
CREATE POLICY "ticket_templates_select_sales_or_manager" ON "public"."ticket_templates" FOR SELECT TO "tindio_authenticated" USING ((( SELECT "private"."has_permission"("ticket_templates"."organization_id", 'sales.create'::"text") AS "has_permission") OR ( SELECT "private"."has_permission"("ticket_templates"."organization_id", 'products.manage'::"text") AS "has_permission")));

DROP POLICY IF EXISTS "ticket_templates_update_manager" ON "public"."ticket_templates";
CREATE POLICY "ticket_templates_update_manager" ON "public"."ticket_templates" FOR UPDATE TO "tindio_authenticated" USING (( SELECT "private"."has_permission"("ticket_templates"."organization_id", 'products.manage'::"text") AS "has_permission")) WITH CHECK (( SELECT "private"."has_permission"("ticket_templates"."organization_id", 'products.manage'::"text") AS "has_permission"));

DROP POLICY IF EXISTS "time_clock_entries_select_self_or_settings_manager" ON "public"."time_clock_entries";
CREATE POLICY "time_clock_entries_select_self_or_settings_manager" ON "public"."time_clock_entries" FOR SELECT TO "tindio_authenticated" USING ((("employee_id" = ( SELECT "private"."current_employee_id"("time_clock_entries"."organization_id") AS "current_employee_id")) OR ((( SELECT "private"."has_permission"("time_clock_entries"."organization_id", 'settings.manage'::"text") AS "has_permission") OR ( SELECT "private"."has_permission"("time_clock_entries"."organization_id", 'employees.manage'::"text") AS "has_permission")) AND ( SELECT "private"."has_store_read_scope"("time_clock_entries"."organization_id", "time_clock_entries"."store_id") AS "has_store_read_scope"))));

-- Move explicit ACLs from provider roles to TINDIO-owned access classes.

REVOKE USAGE ON SCHEMA "private" FROM "authenticated";
GRANT USAGE ON SCHEMA "private" TO "tindio_authenticated";

REVOKE USAGE ON SCHEMA "public" FROM "anon";
GRANT USAGE ON SCHEMA "public" TO "tindio_anon";

REVOKE USAGE ON SCHEMA "public" FROM "authenticated";
GRANT USAGE ON SCHEMA "public" TO "tindio_authenticated";

REVOKE USAGE ON SCHEMA "public" FROM "service_role";
GRANT USAGE ON SCHEMA "public" TO "tindio_service";

REVOKE ALL ON FUNCTION "private"."accept_employee_invitation"("invitation_token_hash" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."accept_employee_invitation"("invitation_token_hash" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."apply_inventory_change_v2"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid", "target_variant_id" "uuid", "target_quantity_delta" numeric, "target_movement_type" "text", "target_actor_employee_id" "uuid", "target_reason" "text", "target_source_type" "text", "target_source_id" "uuid", "target_unit_cost_minor" bigint, "target_reason_code" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."apply_inventory_change_v2"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid", "target_variant_id" "uuid", "target_quantity_delta" numeric, "target_movement_type" "text", "target_actor_employee_id" "uuid", "target_reason" "text", "target_source_type" "text", "target_source_id" "uuid", "target_unit_cost_minor" bigint, "target_reason_code" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."approve_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."approve_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."approve_manager_approval"("target_organization_id" "uuid", "target_approval_request_id" "uuid", "target_approver_employee_number" "text", "target_pin" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."approve_manager_approval"("target_organization_id" "uuid", "target_approval_request_id" "uuid", "target_approver_employee_number" "text", "target_pin" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."approve_stock_request"("target_organization_id" "uuid", "target_stock_request_id" "uuid", "target_lines" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."approve_stock_request"("target_organization_id" "uuid", "target_stock_request_id" "uuid", "target_lines" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."authorize_sensitive_operation"("target_organization_id" "uuid", "target_operation_code" "text", "target_approval_request_id" "uuid", "target_expected_payload" "jsonb", "target_execution_idempotency_key" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."authorize_sensitive_operation"("target_organization_id" "uuid", "target_operation_code" "text", "target_approval_request_id" "uuid", "target_expected_payload" "jsonb", "target_execution_idempotency_key" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."can_access_employee_store_scope"("target_organization_id" "uuid", "target_employee_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."can_access_employee_store_scope"("target_organization_id" "uuid", "target_employee_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."can_access_kitchen_realtime_topic"("target_topic" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."can_access_kitchen_realtime_topic"("target_topic" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."can_grant_role"("target_organization_id" "uuid", "target_role_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."can_grant_role"("target_organization_id" "uuid", "target_role_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."can_view_employee_profile"("target_profile_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."can_view_employee_profile"("target_profile_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."cancel_inventory_count"("target_organization_id" "uuid", "target_inventory_count_id" "uuid", "target_note" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."cancel_inventory_count"("target_organization_id" "uuid", "target_inventory_count_id" "uuid", "target_note" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."cancel_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."cancel_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."change_employee_lifecycle"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_action" "text", "target_reason" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."change_employee_lifecycle"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_action" "text", "target_reason" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."checkout_advanced_sale"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_idempotency_key" "uuid", "target_items" "jsonb", "target_payments" "jsonb", "target_customer_id" "uuid", "target_loyalty_redemption_points" integer, "target_discount_id" "uuid", "target_tax_rate_id" "uuid", "target_dining_option_id" "uuid", "target_open_ticket_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."checkout_advanced_sale"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_idempotency_key" "uuid", "target_items" "jsonb", "target_payments" "jsonb", "target_customer_id" "uuid", "target_loyalty_redemption_points" integer, "target_discount_id" "uuid", "target_tax_rate_id" "uuid", "target_dining_option_id" "uuid", "target_open_ticket_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."checkout_cash_sale"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_cash_tendered_minor" bigint, "target_idempotency_key" "uuid", "target_items" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."checkout_cash_sale"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_cash_tendered_minor" bigint, "target_idempotency_key" "uuid", "target_items" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."checkout_sale"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_idempotency_key" "uuid", "target_items" "jsonb", "target_payments" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."checkout_sale"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_idempotency_key" "uuid", "target_items" "jsonb", "target_payments" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."checkout_sale"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_idempotency_key" "uuid", "target_items" "jsonb", "target_payments" "jsonb", "target_customer_id" "uuid", "target_loyalty_redemption_points" integer) FROM "authenticated";
GRANT ALL ON FUNCTION "private"."checkout_sale"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_idempotency_key" "uuid", "target_items" "jsonb", "target_payments" "jsonb", "target_customer_id" "uuid", "target_loyalty_redemption_points" integer) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."clock_in_employee"("target_organization_id" "uuid", "target_store_id" "uuid", "target_clock_in_note" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."clock_in_employee"("target_organization_id" "uuid", "target_store_id" "uuid", "target_clock_in_note" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."clock_in_employee_with_pin"("target_organization_id" "uuid", "target_store_id" "uuid", "target_employee_id" "uuid", "target_pin" "text", "target_request_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."clock_in_employee_with_pin"("target_organization_id" "uuid", "target_store_id" "uuid", "target_employee_id" "uuid", "target_pin" "text", "target_request_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."clock_out_employee"("target_organization_id" "uuid", "target_clock_out_note" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."clock_out_employee"("target_organization_id" "uuid", "target_clock_out_note" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."clock_out_employee_with_pin"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_pin" "text", "target_request_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."clock_out_employee_with_pin"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_pin" "text", "target_request_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."create_catalog_product"("target_organization_id" "uuid", "target_category_id" "uuid", "target_name" "text", "target_description" "text", "target_product_type" "text", "target_sku" "text", "target_barcode" "text", "target_price_minor" bigint, "target_cost_minor" bigint, "target_track_inventory" boolean, "target_unit" "text", "target_store_ids" "uuid"[], "target_variants" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."create_catalog_product"("target_organization_id" "uuid", "target_category_id" "uuid", "target_name" "text", "target_description" "text", "target_product_type" "text", "target_sku" "text", "target_barcode" "text", "target_price_minor" bigint, "target_cost_minor" bigint, "target_track_inventory" boolean, "target_unit" "text", "target_store_ids" "uuid"[], "target_variants" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."create_catalog_product_v2"("target_organization_id" "uuid", "target_category_id" "uuid", "target_name" "text", "target_description" "text", "target_product_type" "text", "target_sku" "text", "target_barcode" "text", "target_price_minor" bigint, "target_cost_minor" bigint, "target_track_inventory" boolean, "target_unit" "text", "target_store_ids" "uuid"[], "target_variants" "jsonb", "target_image_url" "text", "target_is_variable_price" boolean, "target_allow_fractional_quantity" boolean) FROM "authenticated";
GRANT ALL ON FUNCTION "private"."create_catalog_product_v2"("target_organization_id" "uuid", "target_category_id" "uuid", "target_name" "text", "target_description" "text", "target_product_type" "text", "target_sku" "text", "target_barcode" "text", "target_price_minor" bigint, "target_cost_minor" bigint, "target_track_inventory" boolean, "target_unit" "text", "target_store_ids" "uuid"[], "target_variants" "jsonb", "target_image_url" "text", "target_is_variable_price" boolean, "target_allow_fractional_quantity" boolean) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."create_direct_stock_transfer"("target_organization_id" "uuid", "target_source_store_id" "uuid", "target_destination_store_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."create_direct_stock_transfer"("target_organization_id" "uuid", "target_source_store_id" "uuid", "target_destination_store_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."create_inventory_adjustment_reason"("target_organization_id" "uuid", "target_code" "text", "target_name" "text", "target_movement_type" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."create_inventory_adjustment_reason"("target_organization_id" "uuid", "target_code" "text", "target_name" "text", "target_movement_type" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."create_inventory_count_batch"("target_organization_id" "uuid", "target_name" "text", "target_note" "text", "target_store_ids" "uuid"[], "target_count_mode" "text", "target_sort_mode" "text", "target_include_zero_stock" boolean) FROM "authenticated";
GRANT ALL ON FUNCTION "private"."create_inventory_count_batch"("target_organization_id" "uuid", "target_name" "text", "target_note" "text", "target_store_ids" "uuid"[], "target_count_mode" "text", "target_sort_mode" "text", "target_include_zero_stock" boolean) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."create_inventory_count_plan"("target_organization_id" "uuid", "target_store_id" "uuid", "target_note" "text", "target_count_mode" "text", "target_scope_type" "text", "target_scope_reference_id" "uuid", "target_selected_items" "jsonb", "target_sort_mode" "text", "target_include_zero_stock" boolean) FROM "authenticated";
GRANT ALL ON FUNCTION "private"."create_inventory_count_plan"("target_organization_id" "uuid", "target_store_id" "uuid", "target_note" "text", "target_count_mode" "text", "target_scope_type" "text", "target_scope_reference_id" "uuid", "target_selected_items" "jsonb", "target_sort_mode" "text", "target_include_zero_stock" boolean) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."create_inventory_transfer_draft"("target_organization_id" "uuid", "target_source_store_id" "uuid", "target_destination_store_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."create_inventory_transfer_draft"("target_organization_id" "uuid", "target_source_store_id" "uuid", "target_destination_store_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."create_stock_request"("target_organization_id" "uuid", "target_requesting_store_id" "uuid", "target_source_warehouse_id" "uuid", "target_note" "text", "target_lines" "jsonb", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."create_stock_request"("target_organization_id" "uuid", "target_requesting_store_id" "uuid", "target_source_warehouse_id" "uuid", "target_note" "text", "target_lines" "jsonb", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."create_supplier"("target_organization_id" "uuid", "target_name" "text", "target_contact_name" "text", "target_email" "text", "target_phone" "text", "target_address" "text", "target_notes" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."create_supplier"("target_organization_id" "uuid", "target_name" "text", "target_contact_name" "text", "target_email" "text", "target_phone" "text", "target_address" "text", "target_notes" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."create_supply_chain_warehouse"("target_organization_id" "uuid", "target_store_id" "uuid", "target_code" "text", "target_name" "text", "target_notes" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."create_supply_chain_warehouse"("target_organization_id" "uuid", "target_store_id" "uuid", "target_code" "text", "target_name" "text", "target_notes" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."current_employee_id"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."current_employee_id"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."delete_catalog_product_if_eligible"("target_organization_id" "uuid", "target_product_id" "uuid", "target_confirmation_name" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."delete_catalog_product_if_eligible"("target_organization_id" "uuid", "target_product_id" "uuid", "target_confirmation_name" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."delete_employee_if_eligible"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_confirmation_number" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."delete_employee_if_eligible"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_confirmation_number" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."dispatch_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."dispatch_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."dispatch_stock_request"("target_organization_id" "uuid", "target_stock_request_id" "uuid", "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."dispatch_stock_request"("target_organization_id" "uuid", "target_stock_request_id" "uuid", "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."employee_has_permission"("target_organization_id" "uuid", "target_employee_id" "uuid", "requested_permission" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."employee_has_permission"("target_organization_id" "uuid", "target_employee_id" "uuid", "requested_permission" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."generate_catalog_identifiers"("target_organization_id" "uuid", "target_product_name" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."generate_catalog_identifiers"("target_organization_id" "uuid", "target_product_name" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."get_attendance_employees"("target_organization_id" "uuid", "target_store_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."get_attendance_employees"("target_organization_id" "uuid", "target_store_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."get_catalog_costs"("target_organization_id" "uuid", "requested_product_ids" "uuid"[]) FROM "authenticated";
GRANT ALL ON FUNCTION "private"."get_catalog_costs"("target_organization_id" "uuid", "requested_product_ids" "uuid"[]) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."get_checkout_stock_warning"("target_organization_id" "uuid", "target_store_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."get_checkout_stock_warning"("target_organization_id" "uuid", "target_store_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."get_current_time_clock_entry"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."get_current_time_clock_entry"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."get_customer_display_management_sessions"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."get_customer_display_management_sessions"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."get_employee_management_detail"("target_organization_id" "uuid", "target_employee_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."get_employee_management_detail"("target_organization_id" "uuid", "target_employee_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."get_inventory_count_awareness"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."get_inventory_count_awareness"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."get_kitchen_orders"("target_organization_id" "uuid", "target_store_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."get_kitchen_orders"("target_organization_id" "uuid", "target_store_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."get_kitchen_station_routes"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."get_kitchen_station_routes"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."get_pos_customer_display_sessions"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."get_pos_customer_display_sessions"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."get_pos_customer_display_sessions_with_ids"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."get_pos_customer_display_sessions_with_ids"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."get_scoped_reporting_snapshot"("target_organization_id" "uuid", "target_start_date" "date", "target_end_date" "date", "target_store_id" "uuid", "target_required_permission" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."get_scoped_reporting_snapshot"("target_organization_id" "uuid", "target_start_date" "date", "target_end_date" "date", "target_store_id" "uuid", "target_required_permission" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."has_active_pos_shift_access"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."has_active_pos_shift_access"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."has_all_inventory_capabilities"("target_organization_id" "uuid", "requested_capabilities" "text"[]) FROM "authenticated";
GRANT ALL ON FUNCTION "private"."has_all_inventory_capabilities"("target_organization_id" "uuid", "requested_capabilities" "text"[]) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."has_any_inventory_capability"("target_organization_id" "uuid", "requested_capabilities" "text"[]) FROM "authenticated";
GRANT ALL ON FUNCTION "private"."has_any_inventory_capability"("target_organization_id" "uuid", "requested_capabilities" "text"[]) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."has_inventory_capability"("target_organization_id" "uuid", "requested_capability" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."has_inventory_capability"("target_organization_id" "uuid", "requested_capability" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."has_organization_membership"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."has_organization_membership"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."has_permission"("target_organization_id" "uuid", "requested_permission" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."has_permission"("target_organization_id" "uuid", "requested_permission" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."has_purchase_order_read_scope"("target_organization_id" "uuid", "target_purchase_order_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."has_purchase_order_read_scope"("target_organization_id" "uuid", "target_purchase_order_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."has_refund_read_scope"("target_organization_id" "uuid", "target_refund_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."has_refund_read_scope"("target_organization_id" "uuid", "target_refund_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."has_sale_read_scope"("target_organization_id" "uuid", "target_sale_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."has_sale_read_scope"("target_organization_id" "uuid", "target_sale_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."has_shift_access"("target_organization_id" "uuid", "target_store_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."has_shift_access"("target_organization_id" "uuid", "target_store_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."has_stock_request_read_scope"("target_organization_id" "uuid", "target_stock_request_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."has_stock_request_read_scope"("target_organization_id" "uuid", "target_stock_request_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."has_stock_transfer_read_scope"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."has_stock_transfer_read_scope"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."has_store_read_scope"("target_organization_id" "uuid", "target_store_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."has_store_read_scope"("target_organization_id" "uuid", "target_store_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."import_customers_csv"("target_organization_id" "uuid", "target_rows" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."import_customers_csv"("target_organization_id" "uuid", "target_rows" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."import_inventory_adjustments_csv"("target_organization_id" "uuid", "target_store_id" "uuid", "target_reason_code" "text", "target_rows" "jsonb", "target_operation_id" "uuid", "target_approval_request_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."import_inventory_adjustments_csv"("target_organization_id" "uuid", "target_store_id" "uuid", "target_reason_code" "text", "target_rows" "jsonb", "target_operation_id" "uuid", "target_approval_request_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."import_inventory_count_lines"("target_organization_id" "uuid", "target_inventory_count_id" "uuid", "target_rows" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."import_inventory_count_lines"("target_organization_id" "uuid", "target_inventory_count_id" "uuid", "target_rows" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."import_suppliers_csv"("target_organization_id" "uuid", "target_rows" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."import_suppliers_csv"("target_organization_id" "uuid", "target_rows" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."is_organization_creator"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."is_organization_creator"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."is_organization_member"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."is_organization_member"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."post_inventory_count_idempotent"("target_organization_id" "uuid", "target_inventory_count_id" "uuid", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."post_inventory_count_idempotent"("target_organization_id" "uuid", "target_inventory_count_id" "uuid", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."provision_customer_display_session"("target_organization_id" "uuid", "target_register_id" "uuid", "target_access_token_hash" "text", "target_realtime_topic" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."provision_customer_display_session"("target_organization_id" "uuid", "target_register_id" "uuid", "target_access_token_hash" "text", "target_realtime_topic" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."receive_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid", "allow_legacy_in_transit" boolean) FROM "authenticated";
GRANT ALL ON FUNCTION "private"."receive_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid", "allow_legacy_in_transit" boolean) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."receive_stock_request"("target_organization_id" "uuid", "target_stock_request_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."receive_stock_request"("target_organization_id" "uuid", "target_stock_request_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."receive_stock_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."receive_stock_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."record_inventory_adjustment"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid", "target_variant_id" "uuid", "target_quantity_delta" numeric, "target_reason_code" "text", "target_note" "text", "target_operation_id" "uuid", "target_approval_request_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."record_inventory_adjustment"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid", "target_variant_id" "uuid", "target_quantity_delta" numeric, "target_reason_code" "text", "target_note" "text", "target_operation_id" "uuid", "target_approval_request_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."refund_sale"("target_organization_id" "uuid", "target_sale_id" "uuid", "target_payment_method_id" "uuid", "target_idempotency_key" "uuid", "target_reason" "text", "target_reference_number" "text", "target_items" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."refund_sale"("target_organization_id" "uuid", "target_sale_id" "uuid", "target_payment_method_id" "uuid", "target_idempotency_key" "uuid", "target_reason" "text", "target_reference_number" "text", "target_items" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."remove_inventory_policy_override"("target_organization_id" "uuid", "target_store_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."remove_inventory_policy_override"("target_organization_id" "uuid", "target_store_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."request_manager_approval"("target_organization_id" "uuid", "target_operation_code" "text", "target_reason" "text", "target_payload" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."request_manager_approval"("target_organization_id" "uuid", "target_operation_code" "text", "target_reason" "text", "target_payload" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."save_inventory_count_line"("target_organization_id" "uuid", "target_inventory_count_id" "uuid", "target_product_id" "uuid", "target_variant_id" "uuid", "target_counted_quantity" numeric) FROM "authenticated";
GRANT ALL ON FUNCTION "private"."save_inventory_count_line"("target_organization_id" "uuid", "target_inventory_count_id" "uuid", "target_product_id" "uuid", "target_variant_id" "uuid", "target_counted_quantity" numeric) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."set_catalog_product_store_availability"("target_organization_id" "uuid", "target_product_id" "uuid", "target_store_ids" "uuid"[]) FROM "authenticated";
GRANT ALL ON FUNCTION "private"."set_catalog_product_store_availability"("target_organization_id" "uuid", "target_product_id" "uuid", "target_store_ids" "uuid"[]) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."set_customer_display_state"("target_organization_id" "uuid", "target_session_id" "uuid", "target_state" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."set_customer_display_state"("target_organization_id" "uuid", "target_session_id" "uuid", "target_state" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."set_employee_pin"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_pin" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."set_employee_pin"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_pin" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."set_kitchen_order_priority"("target_organization_id" "uuid", "target_kitchen_order_id" "uuid", "target_priority" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."set_kitchen_order_priority"("target_organization_id" "uuid", "target_kitchen_order_id" "uuid", "target_priority" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."set_kitchen_station_category_route"("target_organization_id" "uuid", "target_category_id" "uuid", "target_station" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."set_kitchen_station_category_route"("target_organization_id" "uuid", "target_category_id" "uuid", "target_station" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."start_stock_request_picking"("target_organization_id" "uuid", "target_stock_request_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."start_stock_request_picking"("target_organization_id" "uuid", "target_stock_request_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."submit_inventory_count_for_review"("target_organization_id" "uuid", "target_inventory_count_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."submit_inventory_count_for_review"("target_organization_id" "uuid", "target_inventory_count_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."submit_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."submit_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."update_approval_rule"("target_organization_id" "uuid", "target_operation_code" "text", "target_decision" "text", "target_amount_threshold_minor" bigint, "target_is_enabled" boolean) FROM "authenticated";
GRANT ALL ON FUNCTION "private"."update_approval_rule"("target_organization_id" "uuid", "target_operation_code" "text", "target_decision" "text", "target_amount_threshold_minor" bigint, "target_is_enabled" boolean) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."update_catalog_product_v2"("target_organization_id" "uuid", "target_product_id" "uuid", "target_name" "text", "target_description" "text", "target_category_id" "uuid", "target_sku" "text", "target_barcode" "text", "target_price_minor" bigint, "target_cost_minor" bigint, "target_track_inventory" boolean, "target_unit" "text", "target_image_url" "text", "target_is_variable_price" boolean, "target_allow_fractional_quantity" boolean) FROM "authenticated";
GRANT ALL ON FUNCTION "private"."update_catalog_product_v2"("target_organization_id" "uuid", "target_product_id" "uuid", "target_name" "text", "target_description" "text", "target_category_id" "uuid", "target_sku" "text", "target_barcode" "text", "target_price_minor" bigint, "target_cost_minor" bigint, "target_track_inventory" boolean, "target_unit" "text", "target_image_url" "text", "target_is_variable_price" boolean, "target_allow_fractional_quantity" boolean) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."update_employee_assignments_unscoped"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_job_title" "text", "target_status" "text", "target_role_ids" "uuid"[], "target_store_ids" "uuid"[]) FROM "authenticated";
GRANT ALL ON FUNCTION "private"."update_employee_assignments_unscoped"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_job_title" "text", "target_status" "text", "target_role_ids" "uuid"[], "target_store_ids" "uuid"[]) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."update_employee_profile"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_full_name" "text", "target_phone" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."update_employee_profile"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_full_name" "text", "target_phone" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."update_inventory_policy"("target_organization_id" "uuid", "target_store_id" "uuid", "target_negative_stock_policy" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."update_inventory_policy"("target_organization_id" "uuid", "target_store_id" "uuid", "target_negative_stock_policy" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."update_kitchen_order_item_status"("target_organization_id" "uuid", "target_kitchen_order_item_id" "uuid", "target_status" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."update_kitchen_order_item_status"("target_organization_id" "uuid", "target_kitchen_order_item_id" "uuid", "target_status" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."update_kitchen_order_status"("target_organization_id" "uuid", "target_kitchen_order_id" "uuid", "target_status" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."update_kitchen_order_status"("target_organization_id" "uuid", "target_kitchen_order_id" "uuid", "target_status" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."update_organization_inventory_policy"("target_organization_id" "uuid", "target_negative_stock_policy" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "private"."update_organization_inventory_policy"("target_organization_id" "uuid", "target_negative_stock_policy" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "private"."update_supplier_lead_time"("target_organization_id" "uuid", "target_supplier_id" "uuid", "target_lead_time_days" integer) FROM "authenticated";
GRANT ALL ON FUNCTION "private"."update_supplier_lead_time"("target_organization_id" "uuid", "target_supplier_id" "uuid", "target_lead_time_days" integer) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."accept_employee_invitation"("invitation_token_hash" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."accept_employee_invitation"("invitation_token_hash" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."add_loyalty_card_stamp"("target_organization_id" "uuid", "target_loyalty_card_id" "uuid", "target_reason" "text", "target_sale_id" "uuid", "target_idempotency_key" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."add_loyalty_card_stamp"("target_organization_id" "uuid", "target_loyalty_card_id" "uuid", "target_reason" "text", "target_sale_id" "uuid", "target_idempotency_key" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."adjust_customer_loyalty_points"("target_organization_id" "uuid", "target_customer_id" "uuid", "target_points_delta" integer, "target_reason" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."adjust_customer_loyalty_points"("target_organization_id" "uuid", "target_customer_id" "uuid", "target_points_delta" integer, "target_reason" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."approve_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."approve_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."approve_manager_approval"("target_organization_id" "uuid", "target_approval_request_id" "uuid", "target_approver_employee_number" "text", "target_pin" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."approve_manager_approval"("target_organization_id" "uuid", "target_approval_request_id" "uuid", "target_approver_employee_number" "text", "target_pin" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."approve_stock_request"("target_organization_id" "uuid", "target_stock_request_id" "uuid", "target_lines" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."approve_stock_request"("target_organization_id" "uuid", "target_stock_request_id" "uuid", "target_lines" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."bootstrap_organization"("organization_name" "text", "store_name" "text", "register_name" "text", "currency_code" "text", "timezone_name" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."bootstrap_organization"("organization_name" "text", "store_name" "text", "register_name" "text", "currency_code" "text", "timezone_name" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."bootstrap_organization_v2"("organization_name" "text", "store_name" "text", "register_name" "text", "currency_code" "text", "timezone_name" "text", "business_type" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."bootstrap_organization_v2"("organization_name" "text", "store_name" "text", "register_name" "text", "currency_code" "text", "timezone_name" "text", "business_type" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."cancel_inventory_count"("target_organization_id" "uuid", "target_inventory_count_id" "uuid", "target_note" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_inventory_count"("target_organization_id" "uuid", "target_inventory_count_id" "uuid", "target_note" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."cancel_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."cancel_open_ticket"("uuid", "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_open_ticket"("uuid", "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."cancel_purchase_order"("target_organization_id" "uuid", "target_purchase_order_id" "uuid", "target_note" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_purchase_order"("target_organization_id" "uuid", "target_purchase_order_id" "uuid", "target_note" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."change_employee_lifecycle"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_action" "text", "target_reason" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."change_employee_lifecycle"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_action" "text", "target_reason" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."change_pos_device_register"("target_organization_id" "uuid", "target_device_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."change_pos_device_register"("target_organization_id" "uuid", "target_device_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."checkout_advanced_sale"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_idempotency_key" "uuid", "target_items" "jsonb", "target_payments" "jsonb", "target_customer_id" "uuid", "target_loyalty_redemption_points" integer, "target_discount_id" "uuid", "target_tax_rate_id" "uuid", "target_dining_option_id" "uuid", "target_open_ticket_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."checkout_advanced_sale"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_idempotency_key" "uuid", "target_items" "jsonb", "target_payments" "jsonb", "target_customer_id" "uuid", "target_loyalty_redemption_points" integer, "target_discount_id" "uuid", "target_tax_rate_id" "uuid", "target_dining_option_id" "uuid", "target_open_ticket_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."checkout_cash_sale"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_cash_tendered_minor" bigint, "target_idempotency_key" "uuid", "target_items" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."checkout_cash_sale"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_cash_tendered_minor" bigint, "target_idempotency_key" "uuid", "target_items" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."checkout_sale"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_idempotency_key" "uuid", "target_items" "jsonb", "target_payments" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."checkout_sale"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_idempotency_key" "uuid", "target_items" "jsonb", "target_payments" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."checkout_sale"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_idempotency_key" "uuid", "target_items" "jsonb", "target_payments" "jsonb", "target_customer_id" "uuid", "target_loyalty_redemption_points" integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."checkout_sale"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_idempotency_key" "uuid", "target_items" "jsonb", "target_payments" "jsonb", "target_customer_id" "uuid", "target_loyalty_redemption_points" integer) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."claim_loyalty_card_reward"("target_organization_id" "uuid", "target_loyalty_card_id" "uuid", "target_reason" "text", "target_sale_id" "uuid", "target_idempotency_key" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."claim_loyalty_card_reward"("target_organization_id" "uuid", "target_loyalty_card_id" "uuid", "target_reason" "text", "target_sale_id" "uuid", "target_idempotency_key" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."clock_in_employee_with_pin"("target_organization_id" "uuid", "target_store_id" "uuid", "target_employee_id" "uuid", "target_pin" "text", "target_request_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."clock_in_employee_with_pin"("target_organization_id" "uuid", "target_store_id" "uuid", "target_employee_id" "uuid", "target_pin" "text", "target_request_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."clock_out_employee_with_pin"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_pin" "text", "target_request_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."clock_out_employee_with_pin"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_pin" "text", "target_request_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."close_register_shift"("target_organization_id" "uuid", "target_shift_id" "uuid", "target_counted_cash_minor" bigint, "target_closing_note" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."close_register_shift"("target_organization_id" "uuid", "target_shift_id" "uuid", "target_counted_cash_minor" bigint, "target_closing_note" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."complete_organization_export"("target_export_session_id" "uuid", "target_record_count" integer, "target_manifest" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."complete_organization_export"("target_export_session_id" "uuid", "target_record_count" integer, "target_manifest" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."create_catalog_product"("target_organization_id" "uuid", "target_category_id" "uuid", "target_name" "text", "target_description" "text", "target_product_type" "text", "target_sku" "text", "target_barcode" "text", "target_price_minor" bigint, "target_cost_minor" bigint, "target_track_inventory" boolean, "target_unit" "text", "target_store_ids" "uuid"[], "target_variants" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."create_catalog_product"("target_organization_id" "uuid", "target_category_id" "uuid", "target_name" "text", "target_description" "text", "target_product_type" "text", "target_sku" "text", "target_barcode" "text", "target_price_minor" bigint, "target_cost_minor" bigint, "target_track_inventory" boolean, "target_unit" "text", "target_store_ids" "uuid"[], "target_variants" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."create_catalog_product_v2"("target_organization_id" "uuid", "target_category_id" "uuid", "target_name" "text", "target_description" "text", "target_product_type" "text", "target_sku" "text", "target_barcode" "text", "target_price_minor" bigint, "target_cost_minor" bigint, "target_track_inventory" boolean, "target_unit" "text", "target_store_ids" "uuid"[], "target_variants" "jsonb", "target_image_url" "text", "target_is_variable_price" boolean, "target_allow_fractional_quantity" boolean) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."create_catalog_product_v2"("target_organization_id" "uuid", "target_category_id" "uuid", "target_name" "text", "target_description" "text", "target_product_type" "text", "target_sku" "text", "target_barcode" "text", "target_price_minor" bigint, "target_cost_minor" bigint, "target_track_inventory" boolean, "target_unit" "text", "target_store_ids" "uuid"[], "target_variants" "jsonb", "target_image_url" "text", "target_is_variable_price" boolean, "target_allow_fractional_quantity" boolean) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."create_catalog_product_v3"("target_organization_id" "uuid", "target_category_id" "uuid", "target_name" "text", "target_description" "text", "target_product_type" "text", "target_sku" "text", "target_barcode" "text", "target_price_minor" bigint, "target_cost_minor" bigint, "target_track_inventory" boolean, "target_unit" "text", "target_store_ids" "uuid"[], "target_variants" "jsonb", "target_image_url" "text", "target_is_variable_price" boolean, "target_allow_fractional_quantity" boolean, "target_composite_inventory_mode" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."create_catalog_product_v3"("target_organization_id" "uuid", "target_category_id" "uuid", "target_name" "text", "target_description" "text", "target_product_type" "text", "target_sku" "text", "target_barcode" "text", "target_price_minor" bigint, "target_cost_minor" bigint, "target_track_inventory" boolean, "target_unit" "text", "target_store_ids" "uuid"[], "target_variants" "jsonb", "target_image_url" "text", "target_is_variable_price" boolean, "target_allow_fractional_quantity" boolean, "target_composite_inventory_mode" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."create_custom_role"("target_organization_id" "uuid", "role_name" "text", "role_code" "text", "role_description" "text", "permission_codes" "text"[]) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."create_custom_role"("target_organization_id" "uuid", "role_name" "text", "role_code" "text", "role_description" "text", "permission_codes" "text"[]) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."create_customer_segment"("target_organization_id" "uuid", "target_name" "text", "target_description" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."create_customer_segment"("target_organization_id" "uuid", "target_name" "text", "target_description" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."create_direct_stock_transfer"("target_organization_id" "uuid", "target_source_store_id" "uuid", "target_destination_store_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."create_direct_stock_transfer"("target_organization_id" "uuid", "target_source_store_id" "uuid", "target_destination_store_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."create_inventory_adjustment_reason"("target_organization_id" "uuid", "target_code" "text", "target_name" "text", "target_movement_type" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."create_inventory_adjustment_reason"("target_organization_id" "uuid", "target_code" "text", "target_name" "text", "target_movement_type" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."create_inventory_count_batch"("target_organization_id" "uuid", "target_name" "text", "target_note" "text", "target_store_ids" "uuid"[], "target_count_mode" "text", "target_sort_mode" "text", "target_include_zero_stock" boolean) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."create_inventory_count_batch"("target_organization_id" "uuid", "target_name" "text", "target_note" "text", "target_store_ids" "uuid"[], "target_count_mode" "text", "target_sort_mode" "text", "target_include_zero_stock" boolean) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."create_inventory_count_plan_v2"("target_organization_id" "uuid", "target_store_id" "uuid", "target_note" "text", "target_count_mode" "text", "target_scope_type" "text", "target_selected_items" "jsonb", "target_sort_mode" "text", "target_include_zero_stock" boolean, "target_scope_reference_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."create_inventory_count_plan_v2"("target_organization_id" "uuid", "target_store_id" "uuid", "target_note" "text", "target_count_mode" "text", "target_scope_type" "text", "target_selected_items" "jsonb", "target_sort_mode" "text", "target_include_zero_stock" boolean, "target_scope_reference_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."create_inventory_transfer_draft"("target_organization_id" "uuid", "target_source_store_id" "uuid", "target_destination_store_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."create_inventory_transfer_draft"("target_organization_id" "uuid", "target_source_store_id" "uuid", "target_destination_store_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."create_product_unit"("target_organization_id" "uuid", "target_product_id" "uuid", "target_unit_code" "text", "target_unit_name" "text", "target_factor_to_base" numeric, "target_is_sale_unit" boolean, "target_is_purchase_unit" boolean, "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."create_product_unit"("target_organization_id" "uuid", "target_product_id" "uuid", "target_unit_code" "text", "target_unit_name" "text", "target_factor_to_base" numeric, "target_is_sale_unit" boolean, "target_is_purchase_unit" boolean, "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."create_purchase_order_v2"("target_organization_id" "uuid", "target_store_id" "uuid", "target_supplier_id" "uuid", "target_notes" "text", "target_lines" "jsonb", "target_operation_id" "uuid", "target_expected_at" "date") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."create_purchase_order_v2"("target_organization_id" "uuid", "target_store_id" "uuid", "target_supplier_id" "uuid", "target_notes" "text", "target_lines" "jsonb", "target_operation_id" "uuid", "target_expected_at" "date") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."create_stock_request"("target_organization_id" "uuid", "target_requesting_store_id" "uuid", "target_source_warehouse_id" "uuid", "target_note" "text", "target_lines" "jsonb", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."create_stock_request"("target_organization_id" "uuid", "target_requesting_store_id" "uuid", "target_source_warehouse_id" "uuid", "target_note" "text", "target_lines" "jsonb", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."create_store_scoped_payment_method"("target_organization_id" "uuid", "target_name" "text", "target_code" "text", "target_payment_type" "text", "target_requires_reference" boolean, "target_store_ids" "uuid"[]) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."create_store_scoped_payment_method"("target_organization_id" "uuid", "target_name" "text", "target_code" "text", "target_payment_type" "text", "target_requires_reference" boolean, "target_store_ids" "uuid"[]) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."create_supplier"("target_organization_id" "uuid", "target_name" "text", "target_contact_name" "text", "target_email" "text", "target_phone" "text", "target_address" "text", "target_notes" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."create_supplier"("target_organization_id" "uuid", "target_name" "text", "target_contact_name" "text", "target_email" "text", "target_phone" "text", "target_address" "text", "target_notes" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."create_supply_chain_warehouse"("target_organization_id" "uuid", "target_store_id" "uuid", "target_code" "text", "target_name" "text", "target_notes" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."create_supply_chain_warehouse"("target_organization_id" "uuid", "target_store_id" "uuid", "target_code" "text", "target_name" "text", "target_notes" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."current_profile_id"() FROM "authenticated";
GRANT ALL ON FUNCTION "public"."current_profile_id"() TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."decide_manager_approval"("target_organization_id" "uuid", "target_approval_request_id" "uuid", "target_decision" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."decide_manager_approval"("target_organization_id" "uuid", "target_approval_request_id" "uuid", "target_decision" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."delete_catalog_product_if_eligible"("target_organization_id" "uuid", "target_product_id" "uuid", "target_confirmation_name" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."delete_catalog_product_if_eligible"("target_organization_id" "uuid", "target_product_id" "uuid", "target_confirmation_name" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."delete_employee_if_eligible"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_confirmation_number" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."delete_employee_if_eligible"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_confirmation_number" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."delete_product_unit"("target_organization_id" "uuid", "target_unit_id" "uuid", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."delete_product_unit"("target_organization_id" "uuid", "target_unit_id" "uuid", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."delete_unused_setup_record"("target_organization_id" "uuid", "target_record_type" "text", "target_record_id" "uuid", "target_confirmation_name" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."delete_unused_setup_record"("target_organization_id" "uuid", "target_record_type" "text", "target_record_id" "uuid", "target_confirmation_name" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."dispatch_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."dispatch_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."dispatch_stock_request"("target_organization_id" "uuid", "target_stock_request_id" "uuid", "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."dispatch_stock_request"("target_organization_id" "uuid", "target_stock_request_id" "uuid", "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."ensure_current_identity_profile"("target_email" "text", "target_full_name" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_current_identity_profile"("target_email" "text", "target_full_name" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."finalize_pos_device_sequence"("target_organization_id" "uuid", "target_device_id" "uuid", "target_device_sequence" bigint, "target_idempotency_key" "uuid", "target_final_state" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_pos_device_sequence"("target_organization_id" "uuid", "target_device_id" "uuid", "target_device_sequence" bigint, "target_idempotency_key" "uuid", "target_final_state" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."generate_catalog_identifiers"("target_organization_id" "uuid", "target_product_name" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."generate_catalog_identifiers"("target_organization_id" "uuid", "target_product_name" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_attendance_employees"("target_organization_id" "uuid", "target_store_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_attendance_employees"("target_organization_id" "uuid", "target_store_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_catalog_costs"("target_organization_id" "uuid", "requested_product_ids" "uuid"[]) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_catalog_costs"("target_organization_id" "uuid", "requested_product_ids" "uuid"[]) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_checkout_stock_warning"("target_organization_id" "uuid", "target_store_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_checkout_stock_warning"("target_organization_id" "uuid", "target_store_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_checkout_stock_warning"("target_organization_id" "uuid", "target_store_id" "uuid", "target_sale_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_checkout_stock_warning"("target_organization_id" "uuid", "target_store_id" "uuid", "target_sale_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_current_time_clock_entry"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_current_time_clock_entry"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_customer_display_bootstrap"("target_access_token_hash" "text") FROM "anon";
GRANT ALL ON FUNCTION "public"."get_customer_display_bootstrap"("target_access_token_hash" "text") TO "tindio_anon";

REVOKE ALL ON FUNCTION "public"."get_customer_display_bootstrap"("target_access_token_hash" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_customer_display_bootstrap"("target_access_token_hash" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_customer_display_management_sessions"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_customer_display_management_sessions"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_customer_display_receipt"("target_access_token_hash" "text", "target_sale_id" "uuid") FROM "anon";
GRANT ALL ON FUNCTION "public"."get_customer_display_receipt"("target_access_token_hash" "text", "target_sale_id" "uuid") TO "tindio_anon";

REVOKE ALL ON FUNCTION "public"."get_customer_display_receipt"("target_access_token_hash" "text", "target_sale_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_customer_display_receipt"("target_access_token_hash" "text", "target_sale_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_customer_loyalty_card_events"("target_organization_id" "uuid", "target_customer_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_customer_loyalty_card_events"("target_organization_id" "uuid", "target_customer_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_customer_loyalty_cards"("target_organization_id" "uuid", "target_customer_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_customer_loyalty_cards"("target_organization_id" "uuid", "target_customer_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_customer_purchase_history"("target_organization_id" "uuid", "target_customer_id" "uuid", "target_limit" integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_customer_purchase_history"("target_organization_id" "uuid", "target_customer_id" "uuid", "target_limit" integer) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_customer_summary"("target_organization_id" "uuid", "target_customer_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_customer_summary"("target_organization_id" "uuid", "target_customer_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_dashboard_operational_snapshot"("target_organization_id" "uuid", "target_start_date" "date", "target_end_date" "date", "target_store_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_operational_snapshot"("target_organization_id" "uuid", "target_start_date" "date", "target_end_date" "date", "target_store_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_dashboard_snapshot"("target_organization_id" "uuid", "target_start_date" "date", "target_end_date" "date", "target_store_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_snapshot"("target_organization_id" "uuid", "target_start_date" "date", "target_end_date" "date", "target_store_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_employee_management_detail"("target_organization_id" "uuid", "target_employee_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_employee_management_detail"("target_organization_id" "uuid", "target_employee_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_inventory_count_awareness"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_inventory_count_awareness"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_inventory_count_batch_documents_workspace_v2"("target_organization_id" "uuid", "target_inventory_count_batch_ids" "uuid"[]) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_inventory_count_batch_documents_workspace_v2"("target_organization_id" "uuid", "target_inventory_count_batch_ids" "uuid"[]) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_inventory_count_batches_workspace_v2"("target_organization_id" "uuid", "target_limit" integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_inventory_count_batches_workspace_v2"("target_organization_id" "uuid", "target_limit" integer) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_inventory_count_lines_workspace_v2"("target_organization_id" "uuid", "target_inventory_count_ids" "uuid"[]) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_inventory_count_lines_workspace_v2"("target_organization_id" "uuid", "target_inventory_count_ids" "uuid"[]) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_inventory_count_suppliers"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_inventory_count_suppliers"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_inventory_counts_workspace_v2"("target_organization_id" "uuid", "target_store_ids" "uuid"[], "target_limit" integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_inventory_counts_workspace_v2"("target_organization_id" "uuid", "target_store_ids" "uuid"[], "target_limit" integer) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_inventory_health_awareness"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_inventory_health_awareness"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_inventory_movement_costs"("target_organization_id" "uuid", "requested_movement_ids" "uuid"[]) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_inventory_movement_costs"("target_organization_id" "uuid", "requested_movement_ids" "uuid"[]) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_inventory_schema_contract"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_inventory_schema_contract"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_inventory_stock_page"("target_organization_id" "uuid", "requested_store_id" "uuid", "requested_search" "text", "requested_category_id" "uuid", "requested_status" "text", "requested_restock_policy" "text", "requested_sort" "text", "requested_page" integer, "requested_page_size" integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_inventory_stock_page"("target_organization_id" "uuid", "requested_store_id" "uuid", "requested_search" "text", "requested_category_id" "uuid", "requested_status" "text", "requested_restock_policy" "text", "requested_sort" "text", "requested_page" integer, "requested_page_size" integer) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_inventory_valuation"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_inventory_valuation"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_kitchen_orders"("target_organization_id" "uuid", "target_store_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_kitchen_orders"("target_organization_id" "uuid", "target_store_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_kitchen_station_routes"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_kitchen_station_routes"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_organization_export_page"("target_export_session_id" "uuid", "target_section" "text", "target_after_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_organization_export_page"("target_export_session_id" "uuid", "target_section" "text", "target_after_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_organization_readiness_access"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_organization_readiness_access"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_organization_recovery_snapshot"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_organization_recovery_snapshot"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_organization_usage_snapshot"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_organization_usage_snapshot"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_pos_bootstrap_core_v2"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_bootstrap_core_v2"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_pos_catalog_product_v2"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_catalog_product_v2"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_pos_catalog_v2"("target_organization_id" "uuid", "target_store_id" "uuid", "target_mode" "text", "target_query" "text", "target_category_id" "uuid", "target_offset" integer, "target_limit" integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_catalog_v2"("target_organization_id" "uuid", "target_store_id" "uuid", "target_mode" "text", "target_query" "text", "target_category_id" "uuid", "target_offset" integer, "target_limit" integer) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_pos_customer_display_sessions"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_customer_display_sessions"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_pos_customer_display_sessions_with_ids"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_customer_display_sessions_with_ids"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_pos_device_sync_checkpoint"("target_organization_id" "uuid", "target_device_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_device_sync_checkpoint"("target_organization_id" "uuid", "target_device_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_pos_favorite_items"("target_organization_id" "uuid", "target_store_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_favorite_items"("target_organization_id" "uuid", "target_store_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_pos_incoming_stock_transfers"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_incoming_stock_transfers"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_pos_live_state_v2"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_live_state_v2"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_pos_modifiers_v2"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_modifiers_v2"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_pos_open_tickets"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_open_tickets"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_pos_product_modifiers"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_product_modifiers"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_pos_receipt_detail"("target_organization_id" "uuid", "target_receipt_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_receipt_detail"("target_organization_id" "uuid", "target_receipt_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_pos_receipt_history"("target_organization_id" "uuid", "target_query" "text", "target_before_receipt_number" bigint, "target_limit" integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_receipt_history"("target_organization_id" "uuid", "target_query" "text", "target_before_receipt_number" bigint, "target_limit" integer) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_pos_recent_items"("target_organization_id" "uuid", "target_store_id" "uuid", "target_limit" integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_recent_items"("target_organization_id" "uuid", "target_store_id" "uuid", "target_limit" integer) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_pos_reference_bundle_v2"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_reference_bundle_v2"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_pos_shift_operational_summary"("target_organization_id" "uuid", "target_shift_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_shift_operational_summary"("target_organization_id" "uuid", "target_shift_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_pos_sync_change_window"("target_organization_id" "uuid", "target_device_id" "uuid", "target_after_revision" bigint, "target_limit" integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_sync_change_window"("target_organization_id" "uuid", "target_device_id" "uuid", "target_after_revision" bigint, "target_limit" integer) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_pos_sync_customer"("target_organization_id" "uuid", "target_device_id" "uuid", "target_customer_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_sync_customer"("target_organization_id" "uuid", "target_device_id" "uuid", "target_customer_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_pos_sync_revision"("target_organization_id" "uuid", "target_device_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_sync_revision"("target_organization_id" "uuid", "target_device_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_pos_ticket_assignees"("target_organization_id" "uuid", "target_store_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_ticket_assignees"("target_organization_id" "uuid", "target_store_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_public_smart_menu"("target_menu_id" "uuid") FROM "anon";
GRANT ALL ON FUNCTION "public"."get_public_smart_menu"("target_menu_id" "uuid") TO "tindio_anon";

REVOKE ALL ON FUNCTION "public"."get_public_smart_menu"("target_menu_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_smart_menu"("target_menu_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_purchase_order_line_costs"("target_organization_id" "uuid", "requested_purchase_order_line_ids" "uuid"[]) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_purchase_order_line_costs"("target_organization_id" "uuid", "requested_purchase_order_line_ids" "uuid"[]) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_reports_snapshot"("target_organization_id" "uuid", "target_start_date" "date", "target_end_date" "date", "target_store_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_reports_snapshot"("target_organization_id" "uuid", "target_start_date" "date", "target_end_date" "date", "target_store_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_shift_audit_history"("target_organization_id" "uuid", "target_limit" integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_shift_audit_history"("target_organization_id" "uuid", "target_limit" integer) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_shift_audit_report"("target_organization_id" "uuid", "target_shift_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_shift_audit_report"("target_organization_id" "uuid", "target_shift_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."get_shift_cash_summary"("target_organization_id" "uuid", "target_shift_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."get_shift_cash_summary"("target_organization_id" "uuid", "target_shift_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."import_catalog_products_v3"("target_organization_id" "uuid", "target_store_ids" "uuid"[], "target_rows" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."import_catalog_products_v3"("target_organization_id" "uuid", "target_store_ids" "uuid"[], "target_rows" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."import_customers_csv"("target_organization_id" "uuid", "target_rows" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."import_customers_csv"("target_organization_id" "uuid", "target_rows" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."import_inventory_adjustments_csv"("target_organization_id" "uuid", "target_store_id" "uuid", "target_reason_code" "text", "target_rows" "jsonb", "target_operation_id" "uuid", "target_approval_request_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."import_inventory_adjustments_csv"("target_organization_id" "uuid", "target_store_id" "uuid", "target_reason_code" "text", "target_rows" "jsonb", "target_operation_id" "uuid", "target_approval_request_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."import_inventory_count_lines"("target_organization_id" "uuid", "target_inventory_count_id" "uuid", "target_rows" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."import_inventory_count_lines"("target_organization_id" "uuid", "target_inventory_count_id" "uuid", "target_rows" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."import_suppliers_csv"("target_organization_id" "uuid", "target_rows" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."import_suppliers_csv"("target_organization_id" "uuid", "target_rows" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."issue_loyalty_card"("target_organization_id" "uuid", "target_customer_id" "uuid", "target_card_code" "text", "target_verification_token" "text", "target_replaces_card_id" "uuid", "target_reason" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."issue_loyalty_card"("target_organization_id" "uuid", "target_customer_id" "uuid", "target_card_code" "text", "target_verification_token" "text", "target_replaces_card_id" "uuid", "target_reason" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."link_sale_exchange"("target_organization_id" "uuid", "target_refund_id" "uuid", "target_replacement_receipt_number" bigint, "target_idempotency_key" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."link_sale_exchange"("target_organization_id" "uuid", "target_refund_id" "uuid", "target_replacement_receipt_number" bigint, "target_idempotency_key" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."manage_organization_lifecycle"("target_organization_id" "uuid", "target_action" "text", "target_reason" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."manage_organization_lifecycle"("target_organization_id" "uuid", "target_action" "text", "target_reason" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."merge_open_tickets"("target_organization_id" "uuid", "target_source_ticket_id" "uuid", "target_destination_ticket_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."merge_open_tickets"("target_organization_id" "uuid", "target_source_ticket_id" "uuid", "target_destination_ticket_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."move_open_ticket_lines"("target_organization_id" "uuid", "target_source_ticket_id" "uuid", "target_destination_ticket_id" "uuid", "target_lines" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."move_open_ticket_lines"("target_organization_id" "uuid", "target_source_ticket_id" "uuid", "target_destination_ticket_id" "uuid", "target_lines" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."open_register_shift"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_opening_cash_minor" bigint, "target_opening_note" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."open_register_shift"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_opening_cash_minor" bigint, "target_opening_note" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."post_inventory_count"("target_organization_id" "uuid", "target_inventory_count_id" "uuid", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."post_inventory_count"("target_organization_id" "uuid", "target_inventory_count_id" "uuid", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."prepare_organization_export"("target_organization_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."prepare_organization_export"("target_organization_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."produce_composite"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid", "target_quantity" numeric, "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."produce_composite"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid", "target_quantity" numeric, "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."provision_customer_display_session"("target_organization_id" "uuid", "target_register_id" "uuid", "target_access_token_hash" "text", "target_realtime_topic" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."provision_customer_display_session"("target_organization_id" "uuid", "target_register_id" "uuid", "target_access_token_hash" "text", "target_realtime_topic" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."queue_receipt_delivery"("target_organization_id" "uuid", "target_receipt_id" "uuid", "target_delivery_channel" "text", "target_recipient" "text", "target_idempotency_key" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."queue_receipt_delivery"("target_organization_id" "uuid", "target_receipt_id" "uuid", "target_delivery_channel" "text", "target_recipient" "text", "target_idempotency_key" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."receive_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."receive_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."receive_purchase_order"("target_organization_id" "uuid", "target_purchase_order_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."receive_purchase_order"("target_organization_id" "uuid", "target_purchase_order_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."receive_stock_request"("target_organization_id" "uuid", "target_stock_request_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."receive_stock_request"("target_organization_id" "uuid", "target_stock_request_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."receive_stock_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."receive_stock_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."record_cash_movement"("target_organization_id" "uuid", "target_shift_id" "uuid", "target_movement_type" "text", "target_amount_minor" bigint, "target_reason" "text", "target_idempotency_key" "uuid", "target_approval_request_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."record_cash_movement"("target_organization_id" "uuid", "target_shift_id" "uuid", "target_movement_type" "text", "target_amount_minor" bigint, "target_reason" "text", "target_idempotency_key" "uuid", "target_approval_request_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."record_inventory_adjustment_v3"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid", "target_quantity_delta" numeric, "target_reason_code" "text", "target_note" "text", "target_operation_id" "uuid", "target_approval_request_id" "uuid", "target_variant_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."record_inventory_adjustment_v3"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid", "target_quantity_delta" numeric, "target_reason_code" "text", "target_note" "text", "target_operation_id" "uuid", "target_approval_request_id" "uuid", "target_variant_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."record_offline_sync_event"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_shift_id" "uuid", "target_device_id" "uuid", "target_idempotency_key" "uuid", "target_local_receipt_reference" "text", "target_local_created_at" timestamp with time zone, "target_state" "text", "target_conflict_type" "text", "target_failure_message" "text", "target_official_receipt_number" bigint) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."record_offline_sync_event"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_shift_id" "uuid", "target_device_id" "uuid", "target_idempotency_key" "uuid", "target_local_receipt_reference" "text", "target_local_created_at" timestamp with time zone, "target_state" "text", "target_conflict_type" "text", "target_failure_message" "text", "target_official_receipt_number" bigint) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."record_organization_recovery_drill"("target_organization_id" "uuid", "target_drill_type" "text", "target_outcome" "text", "target_recovery_point_at" timestamp with time zone, "target_duration_minutes" integer, "target_notes" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."record_organization_recovery_drill"("target_organization_id" "uuid", "target_drill_type" "text", "target_outcome" "text", "target_recovery_point_at" timestamp with time zone, "target_duration_minutes" integer, "target_notes" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."refund_sale"("target_organization_id" "uuid", "target_sale_id" "uuid", "target_payment_method_id" "uuid", "target_idempotency_key" "uuid", "target_reason" "text", "target_reference_number" "text", "target_items" "jsonb", "target_approval_request_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."refund_sale"("target_organization_id" "uuid", "target_sale_id" "uuid", "target_payment_method_id" "uuid", "target_idempotency_key" "uuid", "target_reason" "text", "target_reference_number" "text", "target_items" "jsonb", "target_approval_request_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."register_pos_device"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_device_id" "uuid", "target_name" "text", "target_app_version" "text", "target_secret" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."register_pos_device"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_device_id" "uuid", "target_name" "text", "target_app_version" "text", "target_secret" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."remove_inventory_policy_override"("target_organization_id" "uuid", "target_store_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."remove_inventory_policy_override"("target_organization_id" "uuid", "target_store_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."report_pos_device_sync_telemetry"("target_organization_id" "uuid", "target_device_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_employee_id" "uuid", "target_employee_name" "text", "target_connection_mode" "text", "target_app_version" "text", "target_last_successful_sync_at" timestamp with time zone, "target_device_checkpoint" bigint, "target_server_checkpoint" bigint, "target_queue_depth" integer, "target_conflict_count" integer, "target_failed_count" integer, "target_offline_since" timestamp with time zone, "target_crash_count" bigint, "target_crash_window_started_at" timestamp with time zone, "target_last_crash_at" timestamp with time zone, "target_api_average_latency_ms" integer, "target_api_max_latency_ms" integer, "target_api_failure_count" integer, "target_sync_average_latency_ms" integer, "target_sync_max_latency_ms" integer, "target_local_database_health" "text", "target_local_schema_version" integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."report_pos_device_sync_telemetry"("target_organization_id" "uuid", "target_device_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_employee_id" "uuid", "target_employee_name" "text", "target_connection_mode" "text", "target_app_version" "text", "target_last_successful_sync_at" timestamp with time zone, "target_device_checkpoint" bigint, "target_server_checkpoint" bigint, "target_queue_depth" integer, "target_conflict_count" integer, "target_failed_count" integer, "target_offline_since" timestamp with time zone, "target_crash_count" bigint, "target_crash_window_started_at" timestamp with time zone, "target_last_crash_at" timestamp with time zone, "target_api_average_latency_ms" integer, "target_api_max_latency_ms" integer, "target_api_failure_count" integer, "target_sync_average_latency_ms" integer, "target_sync_max_latency_ms" integer, "target_local_database_health" "text", "target_local_schema_version" integer) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."request_manager_approval"("target_organization_id" "uuid", "target_operation_code" "text", "target_reason" "text", "target_payload" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."request_manager_approval"("target_organization_id" "uuid", "target_operation_code" "text", "target_reason" "text", "target_payload" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."reserve_pos_device_sequence"("target_organization_id" "uuid", "target_device_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_device_sequence" bigint, "target_idempotency_key" "uuid", "target_local_receipt_reference" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."reserve_pos_device_sequence"("target_organization_id" "uuid", "target_device_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_device_sequence" bigint, "target_idempotency_key" "uuid", "target_local_receipt_reference" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."restore_tindio_payment_preset"("target_organization_id" "uuid", "target_preset_code" "text", "target_store_ids" "uuid"[]) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."restore_tindio_payment_preset"("target_organization_id" "uuid", "target_preset_code" "text", "target_store_ids" "uuid"[]) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."return_to_supplier"("target_organization_id" "uuid", "target_store_id" "uuid", "target_supplier_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."return_to_supplier"("target_organization_id" "uuid", "target_store_id" "uuid", "target_supplier_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."revoke_loyalty_card"("target_organization_id" "uuid", "target_loyalty_card_id" "uuid", "target_reason" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."revoke_loyalty_card"("target_organization_id" "uuid", "target_loyalty_card_id" "uuid", "target_reason" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."revoke_pos_device"("target_organization_id" "uuid", "target_device_id" "uuid", "target_reason" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."revoke_pos_device"("target_organization_id" "uuid", "target_device_id" "uuid", "target_reason" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."rotate_loyalty_card_qr"("target_organization_id" "uuid", "target_loyalty_card_id" "uuid", "target_verification_token" "text", "target_reason" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."rotate_loyalty_card_qr"("target_organization_id" "uuid", "target_loyalty_card_id" "uuid", "target_verification_token" "text", "target_reason" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."save_inventory_count_line_v2"("target_organization_id" "uuid", "target_inventory_count_id" "uuid", "target_product_id" "uuid", "target_counted_quantity" numeric, "target_variant_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."save_inventory_count_line_v2"("target_organization_id" "uuid", "target_inventory_count_id" "uuid", "target_product_id" "uuid", "target_counted_quantity" numeric, "target_variant_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."save_open_ticket"("uuid", "uuid", "uuid", "uuid", "uuid", "uuid", "text", "text", "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."save_open_ticket"("uuid", "uuid", "uuid", "uuid", "uuid", "uuid", "text", "text", "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."save_open_ticket_v2"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_ticket_id" "uuid", "target_customer_id" "uuid", "target_dining_option_id" "uuid", "target_assigned_employee_id" "uuid", "target_label" "text", "target_note" "text", "target_cart" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."save_open_ticket_v2"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_ticket_id" "uuid", "target_customer_id" "uuid", "target_dining_option_id" "uuid", "target_assigned_employee_id" "uuid", "target_label" "text", "target_note" "text", "target_cart" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."save_smart_menu_configuration"("target_store_id" "uuid", "target_is_enabled" boolean, "target_show_prices" boolean, "target_show_images" boolean, "target_show_unavailable" boolean, "target_show_variants" boolean, "target_show_modifiers" boolean, "target_category_ids" "uuid"[], "target_product_ids" "uuid"[]) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."save_smart_menu_configuration"("target_store_id" "uuid", "target_is_enabled" boolean, "target_show_prices" boolean, "target_show_images" boolean, "target_show_unavailable" boolean, "target_show_variants" boolean, "target_show_modifiers" boolean, "target_category_ids" "uuid"[], "target_product_ids" "uuid"[]) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."search_pos_catalog"("target_organization_id" "uuid", "target_store_id" "uuid", "target_query" "text", "target_category_id" "uuid", "target_offset" integer, "target_limit" integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."search_pos_catalog"("target_organization_id" "uuid", "target_store_id" "uuid", "target_query" "text", "target_category_id" "uuid", "target_offset" integer, "target_limit" integer) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."search_pos_customers"("target_organization_id" "uuid", "target_store_id" "uuid", "target_query" "text", "target_limit" integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."search_pos_customers"("target_organization_id" "uuid", "target_store_id" "uuid", "target_query" "text", "target_limit" integer) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."set_catalog_product_archived_safely"("target_organization_id" "uuid", "target_product_id" "uuid", "target_is_archived" boolean) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."set_catalog_product_archived_safely"("target_organization_id" "uuid", "target_product_id" "uuid", "target_is_archived" boolean) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."set_catalog_product_store_availability"("target_organization_id" "uuid", "target_product_id" "uuid", "target_store_ids" "uuid"[]) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."set_catalog_product_store_availability"("target_organization_id" "uuid", "target_product_id" "uuid", "target_store_ids" "uuid"[]) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."set_catalog_product_store_configuration_v3"("target_organization_id" "uuid", "target_product_id" "uuid", "target_store_id" "uuid", "target_price_override_minor" bigint, "target_restock_policy" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."set_catalog_product_store_configuration_v3"("target_organization_id" "uuid", "target_product_id" "uuid", "target_store_id" "uuid", "target_price_override_minor" bigint, "target_restock_policy" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."set_customer_display_state"("target_organization_id" "uuid", "target_session_id" "uuid", "target_state" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."set_customer_display_state"("target_organization_id" "uuid", "target_session_id" "uuid", "target_state" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."set_employee_pin"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_pin" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."set_employee_pin"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_pin" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."set_kitchen_order_priority"("target_organization_id" "uuid", "target_kitchen_order_id" "uuid", "target_priority" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."set_kitchen_order_priority"("target_organization_id" "uuid", "target_kitchen_order_id" "uuid", "target_priority" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."set_kitchen_station_category_route"("target_organization_id" "uuid", "target_category_id" "uuid", "target_station" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."set_kitchen_station_category_route"("target_organization_id" "uuid", "target_category_id" "uuid", "target_station" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."set_payment_method_offline_policy"("target_organization_id" "uuid", "target_payment_method_id" "uuid", "target_offline_policy" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."set_payment_method_offline_policy"("target_organization_id" "uuid", "target_payment_method_id" "uuid", "target_offline_policy" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."set_pos_favorite_tile"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid", "target_variant_id" "uuid", "target_is_favorite" boolean) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."set_pos_favorite_tile"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid", "target_variant_id" "uuid", "target_is_favorite" boolean) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."set_store_payment_method_configuration"("target_organization_id" "uuid", "target_store_id" "uuid", "target_payment_method_id" "uuid", "target_is_enabled" boolean) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."set_store_payment_method_configuration"("target_organization_id" "uuid", "target_store_id" "uuid", "target_payment_method_id" "uuid", "target_is_enabled" boolean) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."split_open_ticket"("target_organization_id" "uuid", "target_source_ticket_id" "uuid", "target_label" "text", "target_lines" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."split_open_ticket"("target_organization_id" "uuid", "target_source_ticket_id" "uuid", "target_label" "text", "target_lines" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."start_stock_request_picking"("target_organization_id" "uuid", "target_stock_request_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."start_stock_request_picking"("target_organization_id" "uuid", "target_stock_request_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."submit_inventory_count_for_review"("target_organization_id" "uuid", "target_inventory_count_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."submit_inventory_count_for_review"("target_organization_id" "uuid", "target_inventory_count_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."submit_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_note" "text", "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."submit_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_note" "text", "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."update_approval_rule"("target_organization_id" "uuid", "target_operation_code" "text", "target_decision" "text", "target_amount_threshold_minor" bigint, "target_is_enabled" boolean) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."update_approval_rule"("target_organization_id" "uuid", "target_operation_code" "text", "target_decision" "text", "target_amount_threshold_minor" bigint, "target_is_enabled" boolean) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."update_business_profile_features"("target_organization_id" "uuid", "target_business_type" "text", "target_feature_settings" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."update_business_profile_features"("target_organization_id" "uuid", "target_business_type" "text", "target_feature_settings" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."update_catalog_product_v2"("target_organization_id" "uuid", "target_product_id" "uuid", "target_name" "text", "target_description" "text", "target_category_id" "uuid", "target_sku" "text", "target_barcode" "text", "target_price_minor" bigint, "target_cost_minor" bigint, "target_track_inventory" boolean, "target_unit" "text", "target_image_url" "text", "target_is_variable_price" boolean, "target_allow_fractional_quantity" boolean) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."update_catalog_product_v2"("target_organization_id" "uuid", "target_product_id" "uuid", "target_name" "text", "target_description" "text", "target_category_id" "uuid", "target_sku" "text", "target_barcode" "text", "target_price_minor" bigint, "target_cost_minor" bigint, "target_track_inventory" boolean, "target_unit" "text", "target_image_url" "text", "target_is_variable_price" boolean, "target_allow_fractional_quantity" boolean) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."update_catalog_product_v3"("target_organization_id" "uuid", "target_product_id" "uuid", "target_name" "text", "target_description" "text", "target_category_id" "uuid", "target_sku" "text", "target_barcode" "text", "target_price_minor" bigint, "target_cost_minor" bigint, "target_track_inventory" boolean, "target_unit" "text", "target_image_url" "text", "target_is_variable_price" boolean, "target_allow_fractional_quantity" boolean, "target_composite_inventory_mode" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."update_catalog_product_v3"("target_organization_id" "uuid", "target_product_id" "uuid", "target_name" "text", "target_description" "text", "target_category_id" "uuid", "target_sku" "text", "target_barcode" "text", "target_price_minor" bigint, "target_cost_minor" bigint, "target_track_inventory" boolean, "target_unit" "text", "target_image_url" "text", "target_is_variable_price" boolean, "target_allow_fractional_quantity" boolean, "target_composite_inventory_mode" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."update_custom_role"("target_organization_id" "uuid", "target_role_id" "uuid", "role_name" "text", "role_description" "text", "permission_codes" "text"[]) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."update_custom_role"("target_organization_id" "uuid", "target_role_id" "uuid", "role_name" "text", "role_description" "text", "permission_codes" "text"[]) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."update_customer_profile"("target_organization_id" "uuid", "target_customer_id" "uuid", "target_full_name" "text", "target_email" "text", "target_phone" "text", "target_address" "text", "target_birthday" "date", "target_notes" "text", "target_loyalty_card_code" "text", "target_segment_ids" "uuid"[]) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."update_customer_profile"("target_organization_id" "uuid", "target_customer_id" "uuid", "target_full_name" "text", "target_email" "text", "target_phone" "text", "target_address" "text", "target_birthday" "date", "target_notes" "text", "target_loyalty_card_code" "text", "target_segment_ids" "uuid"[]) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."update_employee_assignments"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_job_title" "text", "target_status" "text", "target_role_ids" "uuid"[], "target_store_ids" "uuid"[]) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."update_employee_assignments"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_job_title" "text", "target_status" "text", "target_role_ids" "uuid"[], "target_store_ids" "uuid"[]) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."update_employee_profile"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_full_name" "text", "target_phone" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."update_employee_profile"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_full_name" "text", "target_phone" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."update_inventory_policy"("target_organization_id" "uuid", "target_store_id" "uuid", "target_negative_stock_policy" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."update_inventory_policy"("target_organization_id" "uuid", "target_store_id" "uuid", "target_negative_stock_policy" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."update_kitchen_order_item_status"("target_organization_id" "uuid", "target_kitchen_order_item_id" "uuid", "target_status" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."update_kitchen_order_item_status"("target_organization_id" "uuid", "target_kitchen_order_item_id" "uuid", "target_status" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."update_kitchen_order_status"("target_organization_id" "uuid", "target_kitchen_order_id" "uuid", "target_status" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."update_kitchen_order_status"("target_organization_id" "uuid", "target_kitchen_order_id" "uuid", "target_status" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."update_organization_inventory_policy"("target_organization_id" "uuid", "target_negative_stock_policy" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."update_organization_inventory_policy"("target_organization_id" "uuid", "target_negative_stock_policy" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."update_payment_method_configuration"("target_organization_id" "uuid", "target_payment_method_id" "uuid", "target_name" "text", "target_is_enabled" boolean, "target_requires_reference" boolean, "target_sort_order" integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."update_payment_method_configuration"("target_organization_id" "uuid", "target_payment_method_id" "uuid", "target_name" "text", "target_is_enabled" boolean, "target_requires_reference" boolean, "target_sort_order" integer) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."update_product_unit"("target_organization_id" "uuid", "target_unit_id" "uuid", "target_unit_code" "text", "target_unit_name" "text", "target_factor_to_base" numeric, "target_is_sale_unit" boolean, "target_is_purchase_unit" boolean, "target_operation_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."update_product_unit"("target_organization_id" "uuid", "target_unit_id" "uuid", "target_unit_code" "text", "target_unit_name" "text", "target_factor_to_base" numeric, "target_is_sale_unit" boolean, "target_is_purchase_unit" boolean, "target_operation_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."update_receipt_delivery_status"("target_delivery_request_id" "uuid", "target_status" "text", "target_provider_message_id" "text", "target_failure_reason" "text") FROM "service_role";
GRANT ALL ON FUNCTION "public"."update_receipt_delivery_status"("target_delivery_request_id" "uuid", "target_status" "text", "target_provider_message_id" "text", "target_failure_reason" "text") TO "tindio_service";

REVOKE ALL ON FUNCTION "public"."update_receipt_settings"("target_organization_id" "uuid", "target_business_name" "text", "target_business_address" "text", "target_business_phone" "text", "target_business_email" "text", "target_business_tax_id" "text", "target_business_website" "text", "target_header_message" "text", "target_footer_message" "text", "target_paper_width_mm" smallint, "target_show_store_address" boolean, "target_show_store_phone" boolean, "target_show_cashier" boolean, "target_show_register" boolean, "target_show_payment_details" boolean) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."update_receipt_settings"("target_organization_id" "uuid", "target_business_name" "text", "target_business_address" "text", "target_business_phone" "text", "target_business_email" "text", "target_business_tax_id" "text", "target_business_website" "text", "target_header_message" "text", "target_footer_message" "text", "target_paper_width_mm" smallint, "target_show_store_address" boolean, "target_show_store_phone" boolean, "target_show_cashier" boolean, "target_show_register" boolean, "target_show_payment_details" boolean) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."update_shift_cash_close_setting"("target_organization_id" "uuid", "target_show_expected_cash_before_close" boolean) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."update_shift_cash_close_setting"("target_organization_id" "uuid", "target_show_expected_cash_before_close" boolean) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."update_supplier"("target_organization_id" "uuid", "target_supplier_id" "uuid", "target_name" "text", "target_contact_name" "text", "target_email" "text", "target_phone" "text", "target_address" "text", "target_notes" "text", "target_is_active" boolean) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."update_supplier"("target_organization_id" "uuid", "target_supplier_id" "uuid", "target_name" "text", "target_contact_name" "text", "target_email" "text", "target_phone" "text", "target_address" "text", "target_notes" "text", "target_is_active" boolean) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."update_supplier_lead_time"("target_organization_id" "uuid", "target_supplier_id" "uuid", "target_lead_time_days" integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."update_supplier_lead_time"("target_organization_id" "uuid", "target_supplier_id" "uuid", "target_lead_time_days" integer) TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."upsert_inventory_replenishment_rule_v2"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid", "target_reorder_point" numeric, "target_target_stock" numeric, "target_variant_id" "uuid", "target_preferred_warehouse_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_inventory_replenishment_rule_v2"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid", "target_reorder_point" numeric, "target_target_stock" numeric, "target_variant_id" "uuid", "target_preferred_warehouse_id" "uuid") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."validate_pos_cart_stock"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_items" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."validate_pos_cart_stock"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_items" "jsonb") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."validate_pos_device"("target_organization_id" "uuid", "target_device_id" "uuid", "target_secret" "text", "target_app_version" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."validate_pos_device"("target_organization_id" "uuid", "target_device_id" "uuid", "target_secret" "text", "target_app_version" "text") TO "tindio_authenticated";

REVOKE ALL ON FUNCTION "public"."verify_loyalty_card_qr"("target_loyalty_card_id" "uuid", "target_verification_token" "text") FROM "anon";
GRANT ALL ON FUNCTION "public"."verify_loyalty_card_qr"("target_loyalty_card_id" "uuid", "target_verification_token" "text") TO "tindio_anon";

REVOKE ALL ON FUNCTION "public"."verify_loyalty_card_qr"("target_loyalty_card_id" "uuid", "target_verification_token" "text") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."verify_loyalty_card_qr"("target_loyalty_card_id" "uuid", "target_verification_token" "text") TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."advanced_checkout_requests" FROM "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."advanced_checkout_requests" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."approval_requests" FROM "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."approval_requests" TO "tindio_anon";

REVOKE SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."approval_requests" FROM "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."approval_requests" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."approval_requests" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."approval_requests" TO "tindio_service";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."approval_rules" FROM "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."approval_rules" TO "tindio_anon";

REVOKE SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."approval_rules" FROM "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."approval_rules" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."approval_rules" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."approval_rules" TO "tindio_service";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_logs" FROM "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_logs" TO "tindio_anon";

REVOKE SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_logs" FROM "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_logs" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_logs" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_logs" TO "tindio_service";

REVOKE SELECT ON TABLE "public"."cash_movements" FROM "authenticated";
GRANT SELECT ON TABLE "public"."cash_movements" TO "tindio_authenticated";

REVOKE SELECT,INSERT ON TABLE "public"."categories" FROM "authenticated";
GRANT SELECT,INSERT ON TABLE "public"."categories" TO "tindio_authenticated";

REVOKE UPDATE("name") ON TABLE "public"."categories" FROM "authenticated";
GRANT UPDATE("name") ON TABLE "public"."categories" TO "tindio_authenticated";

REVOKE UPDATE("description") ON TABLE "public"."categories" FROM "authenticated";
GRANT UPDATE("description") ON TABLE "public"."categories" TO "tindio_authenticated";

REVOKE UPDATE("icon") ON TABLE "public"."categories" FROM "authenticated";
GRANT UPDATE("icon") ON TABLE "public"."categories" TO "tindio_authenticated";

REVOKE UPDATE("color") ON TABLE "public"."categories" FROM "authenticated";
GRANT UPDATE("color") ON TABLE "public"."categories" TO "tindio_authenticated";

REVOKE UPDATE("sort_order") ON TABLE "public"."categories" FROM "authenticated";
GRANT UPDATE("sort_order") ON TABLE "public"."categories" TO "tindio_authenticated";

REVOKE UPDATE("is_archived") ON TABLE "public"."categories" FROM "authenticated";
GRANT UPDATE("is_archived") ON TABLE "public"."categories" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."checkout_requests" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."checkout_requests" TO "tindio_service";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."customer_display_sessions" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."customer_display_sessions" TO "tindio_service";

REVOKE SELECT ON TABLE "public"."customer_segment_memberships" FROM "authenticated";
GRANT SELECT ON TABLE "public"."customer_segment_memberships" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."customer_segments" FROM "authenticated";
GRANT SELECT ON TABLE "public"."customer_segments" TO "tindio_authenticated";

REVOKE SELECT,INSERT ON TABLE "public"."customers" FROM "authenticated";
GRANT SELECT,INSERT ON TABLE "public"."customers" TO "tindio_authenticated";

REVOKE UPDATE("full_name") ON TABLE "public"."customers" FROM "authenticated";
GRANT UPDATE("full_name") ON TABLE "public"."customers" TO "tindio_authenticated";

REVOKE UPDATE("email") ON TABLE "public"."customers" FROM "authenticated";
GRANT UPDATE("email") ON TABLE "public"."customers" TO "tindio_authenticated";

REVOKE UPDATE("phone") ON TABLE "public"."customers" FROM "authenticated";
GRANT UPDATE("phone") ON TABLE "public"."customers" TO "tindio_authenticated";

REVOKE UPDATE("address") ON TABLE "public"."customers" FROM "authenticated";
GRANT UPDATE("address") ON TABLE "public"."customers" TO "tindio_authenticated";

REVOKE UPDATE("birthday") ON TABLE "public"."customers" FROM "authenticated";
GRANT UPDATE("birthday") ON TABLE "public"."customers" TO "tindio_authenticated";

REVOKE UPDATE("notes") ON TABLE "public"."customers" FROM "authenticated";
GRANT UPDATE("notes") ON TABLE "public"."customers" TO "tindio_authenticated";

REVOKE UPDATE("status") ON TABLE "public"."customers" FROM "authenticated";
GRANT UPDATE("status") ON TABLE "public"."customers" TO "tindio_authenticated";

REVOKE SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."dining_options" FROM "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."dining_options" TO "tindio_authenticated";

REVOKE SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."discounts" FROM "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."discounts" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."employee_invitations" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."employee_invitations" TO "tindio_service";

REVOKE SELECT,INSERT ON TABLE "public"."employee_invitations" FROM "authenticated";
GRANT SELECT,INSERT ON TABLE "public"."employee_invitations" TO "tindio_authenticated";

REVOKE UPDATE("revoked_at") ON TABLE "public"."employee_invitations" FROM "authenticated";
GRANT UPDATE("revoked_at") ON TABLE "public"."employee_invitations" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."employee_roles" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."employee_roles" TO "tindio_service";

REVOKE SELECT,INSERT,DELETE ON TABLE "public"."employee_roles" FROM "authenticated";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."employee_roles" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."employee_stores" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."employee_stores" TO "tindio_service";

REVOKE SELECT,INSERT,DELETE ON TABLE "public"."employee_stores" FROM "authenticated";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."employee_stores" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."employees" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."employees" TO "tindio_service";

REVOKE SELECT,INSERT ON TABLE "public"."employees" FROM "authenticated";
GRANT SELECT,INSERT ON TABLE "public"."employees" TO "tindio_authenticated";

REVOKE UPDATE("employee_number") ON TABLE "public"."employees" FROM "authenticated";
GRANT UPDATE("employee_number") ON TABLE "public"."employees" TO "tindio_authenticated";

REVOKE UPDATE("job_title") ON TABLE "public"."employees" FROM "authenticated";
GRANT UPDATE("job_title") ON TABLE "public"."employees" TO "tindio_authenticated";

REVOKE UPDATE("status") ON TABLE "public"."employees" FROM "authenticated";
GRANT UPDATE("status") ON TABLE "public"."employees" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."goods_receipt_lines" FROM "authenticated";
GRANT SELECT ON TABLE "public"."goods_receipt_lines" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."goods_receipts" FROM "authenticated";
GRANT SELECT ON TABLE "public"."goods_receipts" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."inventory_adjustment_import_batches" FROM "authenticated";
GRANT SELECT ON TABLE "public"."inventory_adjustment_import_batches" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."inventory_adjustment_reasons" FROM "authenticated";
GRANT SELECT ON TABLE "public"."inventory_adjustment_reasons" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."inventory_adjustments" FROM "authenticated";
GRANT SELECT ON TABLE "public"."inventory_adjustments" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."inventory_count_batch_documents" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."inventory_count_batch_documents" TO "tindio_service";

REVOKE SELECT ON TABLE "public"."inventory_count_batch_documents" FROM "authenticated";
GRANT SELECT ON TABLE "public"."inventory_count_batch_documents" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."inventory_count_batches" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."inventory_count_batches" TO "tindio_service";

REVOKE SELECT ON TABLE "public"."inventory_count_batches" FROM "authenticated";
GRANT SELECT ON TABLE "public"."inventory_count_batches" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."inventory_count_lines" FROM "authenticated";
GRANT SELECT ON TABLE "public"."inventory_count_lines" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."inventory_counts" FROM "authenticated";
GRANT SELECT ON TABLE "public"."inventory_counts" TO "tindio_authenticated";

REVOKE SELECT("id") ON TABLE "public"."inventory_levels" FROM "authenticated";
GRANT SELECT("id") ON TABLE "public"."inventory_levels" TO "tindio_authenticated";

REVOKE SELECT("organization_id") ON TABLE "public"."inventory_levels" FROM "authenticated";
GRANT SELECT("organization_id") ON TABLE "public"."inventory_levels" TO "tindio_authenticated";

REVOKE SELECT("store_id") ON TABLE "public"."inventory_levels" FROM "authenticated";
GRANT SELECT("store_id") ON TABLE "public"."inventory_levels" TO "tindio_authenticated";

REVOKE SELECT("product_id") ON TABLE "public"."inventory_levels" FROM "authenticated";
GRANT SELECT("product_id") ON TABLE "public"."inventory_levels" TO "tindio_authenticated";

REVOKE SELECT("variant_id") ON TABLE "public"."inventory_levels" FROM "authenticated";
GRANT SELECT("variant_id") ON TABLE "public"."inventory_levels" TO "tindio_authenticated";

REVOKE SELECT("quantity") ON TABLE "public"."inventory_levels" FROM "authenticated";
GRANT SELECT("quantity") ON TABLE "public"."inventory_levels" TO "tindio_authenticated";

REVOKE SELECT("updated_at") ON TABLE "public"."inventory_levels" FROM "authenticated";
GRANT SELECT("updated_at") ON TABLE "public"."inventory_levels" TO "tindio_authenticated";

REVOKE SELECT("id") ON TABLE "public"."inventory_movements" FROM "authenticated";
GRANT SELECT("id") ON TABLE "public"."inventory_movements" TO "tindio_authenticated";

REVOKE SELECT("organization_id") ON TABLE "public"."inventory_movements" FROM "authenticated";
GRANT SELECT("organization_id") ON TABLE "public"."inventory_movements" TO "tindio_authenticated";

REVOKE SELECT("store_id") ON TABLE "public"."inventory_movements" FROM "authenticated";
GRANT SELECT("store_id") ON TABLE "public"."inventory_movements" TO "tindio_authenticated";

REVOKE SELECT("product_id") ON TABLE "public"."inventory_movements" FROM "authenticated";
GRANT SELECT("product_id") ON TABLE "public"."inventory_movements" TO "tindio_authenticated";

REVOKE SELECT("variant_id") ON TABLE "public"."inventory_movements" FROM "authenticated";
GRANT SELECT("variant_id") ON TABLE "public"."inventory_movements" TO "tindio_authenticated";

REVOKE SELECT("quantity_delta") ON TABLE "public"."inventory_movements" FROM "authenticated";
GRANT SELECT("quantity_delta") ON TABLE "public"."inventory_movements" TO "tindio_authenticated";

REVOKE SELECT("quantity_before") ON TABLE "public"."inventory_movements" FROM "authenticated";
GRANT SELECT("quantity_before") ON TABLE "public"."inventory_movements" TO "tindio_authenticated";

REVOKE SELECT("quantity_after") ON TABLE "public"."inventory_movements" FROM "authenticated";
GRANT SELECT("quantity_after") ON TABLE "public"."inventory_movements" TO "tindio_authenticated";

REVOKE SELECT("movement_type") ON TABLE "public"."inventory_movements" FROM "authenticated";
GRANT SELECT("movement_type") ON TABLE "public"."inventory_movements" TO "tindio_authenticated";

REVOKE SELECT("actor_employee_id") ON TABLE "public"."inventory_movements" FROM "authenticated";
GRANT SELECT("actor_employee_id") ON TABLE "public"."inventory_movements" TO "tindio_authenticated";

REVOKE SELECT("reason") ON TABLE "public"."inventory_movements" FROM "authenticated";
GRANT SELECT("reason") ON TABLE "public"."inventory_movements" TO "tindio_authenticated";

REVOKE SELECT("source_type") ON TABLE "public"."inventory_movements" FROM "authenticated";
GRANT SELECT("source_type") ON TABLE "public"."inventory_movements" TO "tindio_authenticated";

REVOKE SELECT("source_id") ON TABLE "public"."inventory_movements" FROM "authenticated";
GRANT SELECT("source_id") ON TABLE "public"."inventory_movements" TO "tindio_authenticated";

REVOKE SELECT("created_at") ON TABLE "public"."inventory_movements" FROM "authenticated";
GRANT SELECT("created_at") ON TABLE "public"."inventory_movements" TO "tindio_authenticated";

REVOKE SELECT("reason_code") ON TABLE "public"."inventory_movements" FROM "authenticated";
GRANT SELECT("reason_code") ON TABLE "public"."inventory_movements" TO "tindio_authenticated";

REVOKE SELECT("unit_snapshot") ON TABLE "public"."inventory_movements" FROM "authenticated";
GRANT SELECT("unit_snapshot") ON TABLE "public"."inventory_movements" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."inventory_policies" FROM "authenticated";
GRANT SELECT ON TABLE "public"."inventory_policies" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."inventory_policy_defaults" FROM "authenticated";
GRANT SELECT ON TABLE "public"."inventory_policy_defaults" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."inventory_replenishment_rules" FROM "authenticated";
GRANT SELECT ON TABLE "public"."inventory_replenishment_rules" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."loyalty_programs" FROM "authenticated";
GRANT SELECT ON TABLE "public"."loyalty_programs" TO "tindio_authenticated";

REVOKE UPDATE("is_enabled") ON TABLE "public"."loyalty_programs" FROM "authenticated";
GRANT UPDATE("is_enabled") ON TABLE "public"."loyalty_programs" TO "tindio_authenticated";

REVOKE UPDATE("earn_spend_minor") ON TABLE "public"."loyalty_programs" FROM "authenticated";
GRANT UPDATE("earn_spend_minor") ON TABLE "public"."loyalty_programs" TO "tindio_authenticated";

REVOKE UPDATE("earn_points") ON TABLE "public"."loyalty_programs" FROM "authenticated";
GRANT UPDATE("earn_points") ON TABLE "public"."loyalty_programs" TO "tindio_authenticated";

REVOKE UPDATE("redemption_value_minor") ON TABLE "public"."loyalty_programs" FROM "authenticated";
GRANT UPDATE("redemption_value_minor") ON TABLE "public"."loyalty_programs" TO "tindio_authenticated";

REVOKE UPDATE("minimum_redemption_points") ON TABLE "public"."loyalty_programs" FROM "authenticated";
GRANT UPDATE("minimum_redemption_points") ON TABLE "public"."loyalty_programs" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."loyalty_transactions" FROM "authenticated";
GRANT SELECT ON TABLE "public"."loyalty_transactions" TO "tindio_authenticated";

REVOKE SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."modifier_groups" FROM "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."modifier_groups" TO "tindio_authenticated";

REVOKE SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."modifier_options" FROM "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."modifier_options" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."offline_sync_events" FROM "authenticated";
GRANT SELECT ON TABLE "public"."offline_sync_events" TO "tindio_authenticated";

REVOKE SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."open_tickets" FROM "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."open_tickets" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."organization_features" FROM "authenticated";
GRANT SELECT ON TABLE "public"."organization_features" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."organizations" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."organizations" TO "tindio_service";

REVOKE SELECT,INSERT ON TABLE "public"."organizations" FROM "authenticated";
GRANT SELECT,INSERT ON TABLE "public"."organizations" TO "tindio_authenticated";

REVOKE UPDATE("name") ON TABLE "public"."organizations" FROM "authenticated";
GRANT UPDATE("name") ON TABLE "public"."organizations" TO "tindio_authenticated";

REVOKE UPDATE("currency_code") ON TABLE "public"."organizations" FROM "authenticated";
GRANT UPDATE("currency_code") ON TABLE "public"."organizations" TO "tindio_authenticated";

REVOKE UPDATE("timezone") ON TABLE "public"."organizations" FROM "authenticated";
GRANT UPDATE("timezone") ON TABLE "public"."organizations" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payment_methods" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payment_methods" TO "tindio_service";

REVOKE SELECT ON TABLE "public"."payment_methods" FROM "authenticated";
GRANT SELECT ON TABLE "public"."payment_methods" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payments" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payments" TO "tindio_service";

REVOKE SELECT ON TABLE "public"."payments" FROM "authenticated";
GRANT SELECT ON TABLE "public"."payments" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."permissions" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."permissions" TO "tindio_service";

REVOKE SELECT ON TABLE "public"."permissions" FROM "authenticated";
GRANT SELECT ON TABLE "public"."permissions" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."pos_device_sync_telemetry" FROM "authenticated";
GRANT SELECT ON TABLE "public"."pos_device_sync_telemetry" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."pos_devices" FROM "authenticated";
GRANT SELECT ON TABLE "public"."pos_devices" TO "tindio_authenticated";

REVOKE UPDATE ON SEQUENCE "public"."pos_sync_changes_revision_seq" FROM "anon";
GRANT UPDATE ON SEQUENCE "public"."pos_sync_changes_revision_seq" TO "tindio_anon";

REVOKE UPDATE ON SEQUENCE "public"."pos_sync_changes_revision_seq" FROM "authenticated";
GRANT UPDATE ON SEQUENCE "public"."pos_sync_changes_revision_seq" TO "tindio_authenticated";

REVOKE UPDATE ON SEQUENCE "public"."pos_sync_changes_revision_seq" FROM "service_role";
GRANT UPDATE ON SEQUENCE "public"."pos_sync_changes_revision_seq" TO "tindio_service";

REVOKE ALL ON TABLE "public"."product_components" FROM "authenticated";
GRANT ALL ON TABLE "public"."product_components" TO "tindio_authenticated";

REVOKE SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."product_modifier_groups" FROM "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."product_modifier_groups" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."product_store_settings" FROM "authenticated";
GRANT SELECT ON TABLE "public"."product_store_settings" TO "tindio_authenticated";

REVOKE INSERT("organization_id") ON TABLE "public"."product_store_settings" FROM "authenticated";
GRANT INSERT("organization_id") ON TABLE "public"."product_store_settings" TO "tindio_authenticated";

REVOKE INSERT("store_id") ON TABLE "public"."product_store_settings" FROM "authenticated";
GRANT INSERT("store_id") ON TABLE "public"."product_store_settings" TO "tindio_authenticated";

REVOKE INSERT("product_id") ON TABLE "public"."product_store_settings" FROM "authenticated";
GRANT INSERT("product_id") ON TABLE "public"."product_store_settings" TO "tindio_authenticated";

REVOKE INSERT("is_available"),UPDATE("is_available") ON TABLE "public"."product_store_settings" FROM "authenticated";
GRANT INSERT("is_available"),UPDATE("is_available") ON TABLE "public"."product_store_settings" TO "tindio_authenticated";

REVOKE SELECT("price_override_minor"),INSERT("price_override_minor"),UPDATE("price_override_minor") ON TABLE "public"."product_store_settings" FROM "authenticated";
GRANT SELECT("price_override_minor"),INSERT("price_override_minor"),UPDATE("price_override_minor") ON TABLE "public"."product_store_settings" TO "tindio_authenticated";

REVOKE SELECT("low_stock_level") ON TABLE "public"."product_store_settings" FROM "authenticated";
GRANT SELECT("low_stock_level") ON TABLE "public"."product_store_settings" TO "tindio_authenticated";

REVOKE SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_units" FROM "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_units" TO "tindio_authenticated";

REVOKE SELECT("id") ON TABLE "public"."product_variants" FROM "authenticated";
GRANT SELECT("id") ON TABLE "public"."product_variants" TO "tindio_authenticated";

REVOKE SELECT("organization_id") ON TABLE "public"."product_variants" FROM "authenticated";
GRANT SELECT("organization_id") ON TABLE "public"."product_variants" TO "tindio_authenticated";

REVOKE SELECT("product_id") ON TABLE "public"."product_variants" FROM "authenticated";
GRANT SELECT("product_id") ON TABLE "public"."product_variants" TO "tindio_authenticated";

REVOKE SELECT("name") ON TABLE "public"."product_variants" FROM "authenticated";
GRANT SELECT("name") ON TABLE "public"."product_variants" TO "tindio_authenticated";

REVOKE SELECT("option_values") ON TABLE "public"."product_variants" FROM "authenticated";
GRANT SELECT("option_values") ON TABLE "public"."product_variants" TO "tindio_authenticated";

REVOKE SELECT("sku") ON TABLE "public"."product_variants" FROM "authenticated";
GRANT SELECT("sku") ON TABLE "public"."product_variants" TO "tindio_authenticated";

REVOKE SELECT("barcode") ON TABLE "public"."product_variants" FROM "authenticated";
GRANT SELECT("barcode") ON TABLE "public"."product_variants" TO "tindio_authenticated";

REVOKE SELECT("price_minor") ON TABLE "public"."product_variants" FROM "authenticated";
GRANT SELECT("price_minor") ON TABLE "public"."product_variants" TO "tindio_authenticated";

REVOKE SELECT("sort_order") ON TABLE "public"."product_variants" FROM "authenticated";
GRANT SELECT("sort_order") ON TABLE "public"."product_variants" TO "tindio_authenticated";

REVOKE SELECT("is_active"),UPDATE("is_active") ON TABLE "public"."product_variants" FROM "authenticated";
GRANT SELECT("is_active"),UPDATE("is_active") ON TABLE "public"."product_variants" TO "tindio_authenticated";

REVOKE SELECT("created_at") ON TABLE "public"."product_variants" FROM "authenticated";
GRANT SELECT("created_at") ON TABLE "public"."product_variants" TO "tindio_authenticated";

REVOKE SELECT("updated_at") ON TABLE "public"."product_variants" FROM "authenticated";
GRANT SELECT("updated_at") ON TABLE "public"."product_variants" TO "tindio_authenticated";

REVOKE SELECT("id") ON TABLE "public"."production_run_components" FROM "authenticated";
GRANT SELECT("id") ON TABLE "public"."production_run_components" TO "tindio_authenticated";

REVOKE SELECT("organization_id") ON TABLE "public"."production_run_components" FROM "authenticated";
GRANT SELECT("organization_id") ON TABLE "public"."production_run_components" TO "tindio_authenticated";

REVOKE SELECT("production_run_id") ON TABLE "public"."production_run_components" FROM "authenticated";
GRANT SELECT("production_run_id") ON TABLE "public"."production_run_components" TO "tindio_authenticated";

REVOKE SELECT("component_product_id") ON TABLE "public"."production_run_components" FROM "authenticated";
GRANT SELECT("component_product_id") ON TABLE "public"."production_run_components" TO "tindio_authenticated";

REVOKE SELECT("component_variant_id") ON TABLE "public"."production_run_components" FROM "authenticated";
GRANT SELECT("component_variant_id") ON TABLE "public"."production_run_components" TO "tindio_authenticated";

REVOKE SELECT("quantity_per_composite_snapshot") ON TABLE "public"."production_run_components" FROM "authenticated";
GRANT SELECT("quantity_per_composite_snapshot") ON TABLE "public"."production_run_components" TO "tindio_authenticated";

REVOKE SELECT("quantity_consumed") ON TABLE "public"."production_run_components" FROM "authenticated";
GRANT SELECT("quantity_consumed") ON TABLE "public"."production_run_components" TO "tindio_authenticated";

REVOKE SELECT("unit_snapshot") ON TABLE "public"."production_run_components" FROM "authenticated";
GRANT SELECT("unit_snapshot") ON TABLE "public"."production_run_components" TO "tindio_authenticated";

REVOKE SELECT("created_at") ON TABLE "public"."production_run_components" FROM "authenticated";
GRANT SELECT("created_at") ON TABLE "public"."production_run_components" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."production_runs" FROM "authenticated";
GRANT SELECT ON TABLE "public"."production_runs" TO "tindio_authenticated";

REVOKE SELECT("id") ON TABLE "public"."products" FROM "authenticated";
GRANT SELECT("id") ON TABLE "public"."products" TO "tindio_authenticated";

REVOKE SELECT("organization_id") ON TABLE "public"."products" FROM "authenticated";
GRANT SELECT("organization_id") ON TABLE "public"."products" TO "tindio_authenticated";

REVOKE SELECT("category_id") ON TABLE "public"."products" FROM "authenticated";
GRANT SELECT("category_id") ON TABLE "public"."products" TO "tindio_authenticated";

REVOKE SELECT("name") ON TABLE "public"."products" FROM "authenticated";
GRANT SELECT("name") ON TABLE "public"."products" TO "tindio_authenticated";

REVOKE SELECT("description") ON TABLE "public"."products" FROM "authenticated";
GRANT SELECT("description") ON TABLE "public"."products" TO "tindio_authenticated";

REVOKE SELECT("product_type") ON TABLE "public"."products" FROM "authenticated";
GRANT SELECT("product_type") ON TABLE "public"."products" TO "tindio_authenticated";

REVOKE SELECT("sku") ON TABLE "public"."products" FROM "authenticated";
GRANT SELECT("sku") ON TABLE "public"."products" TO "tindio_authenticated";

REVOKE SELECT("barcode") ON TABLE "public"."products" FROM "authenticated";
GRANT SELECT("barcode") ON TABLE "public"."products" TO "tindio_authenticated";

REVOKE SELECT("price_minor") ON TABLE "public"."products" FROM "authenticated";
GRANT SELECT("price_minor") ON TABLE "public"."products" TO "tindio_authenticated";

REVOKE SELECT("track_inventory") ON TABLE "public"."products" FROM "authenticated";
GRANT SELECT("track_inventory") ON TABLE "public"."products" TO "tindio_authenticated";

REVOKE SELECT("unit") ON TABLE "public"."products" FROM "authenticated";
GRANT SELECT("unit") ON TABLE "public"."products" TO "tindio_authenticated";

REVOKE SELECT("status"),UPDATE("status") ON TABLE "public"."products" FROM "authenticated";
GRANT SELECT("status"),UPDATE("status") ON TABLE "public"."products" TO "tindio_authenticated";

REVOKE SELECT("created_at") ON TABLE "public"."products" FROM "authenticated";
GRANT SELECT("created_at") ON TABLE "public"."products" TO "tindio_authenticated";

REVOKE SELECT("updated_at") ON TABLE "public"."products" FROM "authenticated";
GRANT SELECT("updated_at") ON TABLE "public"."products" TO "tindio_authenticated";

REVOKE SELECT("image_url"),UPDATE("image_url") ON TABLE "public"."products" FROM "authenticated";
GRANT SELECT("image_url"),UPDATE("image_url") ON TABLE "public"."products" TO "tindio_authenticated";

REVOKE SELECT("is_variable_price"),UPDATE("is_variable_price") ON TABLE "public"."products" FROM "authenticated";
GRANT SELECT("is_variable_price"),UPDATE("is_variable_price") ON TABLE "public"."products" TO "tindio_authenticated";

REVOKE SELECT("allow_fractional_quantity"),UPDATE("allow_fractional_quantity") ON TABLE "public"."products" FROM "authenticated";
GRANT SELECT("allow_fractional_quantity"),UPDATE("allow_fractional_quantity") ON TABLE "public"."products" TO "tindio_authenticated";

REVOKE SELECT("is_composite"),UPDATE("is_composite") ON TABLE "public"."products" FROM "authenticated";
GRANT SELECT("is_composite"),UPDATE("is_composite") ON TABLE "public"."products" TO "tindio_authenticated";

REVOKE SELECT("composite_inventory_mode") ON TABLE "public"."products" FROM "authenticated";
GRANT SELECT("composite_inventory_mode") ON TABLE "public"."products" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "tindio_service";

REVOKE SELECT ON TABLE "public"."profiles" FROM "authenticated";
GRANT SELECT ON TABLE "public"."profiles" TO "tindio_authenticated";

REVOKE UPDATE("full_name") ON TABLE "public"."profiles" FROM "authenticated";
GRANT UPDATE("full_name") ON TABLE "public"."profiles" TO "tindio_authenticated";

REVOKE UPDATE("phone") ON TABLE "public"."profiles" FROM "authenticated";
GRANT UPDATE("phone") ON TABLE "public"."profiles" TO "tindio_authenticated";

REVOKE UPDATE("avatar_url") ON TABLE "public"."profiles" FROM "authenticated";
GRANT UPDATE("avatar_url") ON TABLE "public"."profiles" TO "tindio_authenticated";

REVOKE SELECT("id") ON TABLE "public"."purchase_order_lines" FROM "authenticated";
GRANT SELECT("id") ON TABLE "public"."purchase_order_lines" TO "tindio_authenticated";

REVOKE SELECT("organization_id") ON TABLE "public"."purchase_order_lines" FROM "authenticated";
GRANT SELECT("organization_id") ON TABLE "public"."purchase_order_lines" TO "tindio_authenticated";

REVOKE SELECT("purchase_order_id") ON TABLE "public"."purchase_order_lines" FROM "authenticated";
GRANT SELECT("purchase_order_id") ON TABLE "public"."purchase_order_lines" TO "tindio_authenticated";

REVOKE SELECT("product_id") ON TABLE "public"."purchase_order_lines" FROM "authenticated";
GRANT SELECT("product_id") ON TABLE "public"."purchase_order_lines" TO "tindio_authenticated";

REVOKE SELECT("variant_id") ON TABLE "public"."purchase_order_lines" FROM "authenticated";
GRANT SELECT("variant_id") ON TABLE "public"."purchase_order_lines" TO "tindio_authenticated";

REVOKE SELECT("product_name_snapshot") ON TABLE "public"."purchase_order_lines" FROM "authenticated";
GRANT SELECT("product_name_snapshot") ON TABLE "public"."purchase_order_lines" TO "tindio_authenticated";

REVOKE SELECT("variant_name_snapshot") ON TABLE "public"."purchase_order_lines" FROM "authenticated";
GRANT SELECT("variant_name_snapshot") ON TABLE "public"."purchase_order_lines" TO "tindio_authenticated";

REVOKE SELECT("unit_snapshot") ON TABLE "public"."purchase_order_lines" FROM "authenticated";
GRANT SELECT("unit_snapshot") ON TABLE "public"."purchase_order_lines" TO "tindio_authenticated";

REVOKE SELECT("ordered_quantity") ON TABLE "public"."purchase_order_lines" FROM "authenticated";
GRANT SELECT("ordered_quantity") ON TABLE "public"."purchase_order_lines" TO "tindio_authenticated";

REVOKE SELECT("received_quantity") ON TABLE "public"."purchase_order_lines" FROM "authenticated";
GRANT SELECT("received_quantity") ON TABLE "public"."purchase_order_lines" TO "tindio_authenticated";

REVOKE SELECT("purchase_unit_code_snapshot") ON TABLE "public"."purchase_order_lines" FROM "authenticated";
GRANT SELECT("purchase_unit_code_snapshot") ON TABLE "public"."purchase_order_lines" TO "tindio_authenticated";

REVOKE SELECT("purchase_unit_factor_to_base") ON TABLE "public"."purchase_order_lines" FROM "authenticated";
GRANT SELECT("purchase_unit_factor_to_base") ON TABLE "public"."purchase_order_lines" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."purchase_orders" FROM "authenticated";
GRANT SELECT ON TABLE "public"."purchase_orders" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."receipt_delivery_requests" FROM "authenticated";
GRANT SELECT ON TABLE "public"."receipt_delivery_requests" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."receipt_settings" FROM "authenticated";
GRANT SELECT ON TABLE "public"."receipt_settings" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."receipts" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."receipts" TO "tindio_service";

REVOKE SELECT ON TABLE "public"."receipts" FROM "authenticated";
GRANT SELECT ON TABLE "public"."receipts" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."refund_items" FROM "authenticated";
GRANT SELECT ON TABLE "public"."refund_items" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."refund_payments" FROM "authenticated";
GRANT SELECT ON TABLE "public"."refund_payments" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."refunds" FROM "authenticated";
GRANT SELECT ON TABLE "public"."refunds" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."registers" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."registers" TO "tindio_service";

REVOKE SELECT,INSERT ON TABLE "public"."registers" FROM "authenticated";
GRANT SELECT,INSERT ON TABLE "public"."registers" TO "tindio_authenticated";

REVOKE UPDATE("name") ON TABLE "public"."registers" FROM "authenticated";
GRANT UPDATE("name") ON TABLE "public"."registers" TO "tindio_authenticated";

REVOKE UPDATE("code") ON TABLE "public"."registers" FROM "authenticated";
GRANT UPDATE("code") ON TABLE "public"."registers" TO "tindio_authenticated";

REVOKE UPDATE("is_active") ON TABLE "public"."registers" FROM "authenticated";
GRANT UPDATE("is_active") ON TABLE "public"."registers" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."role_permissions" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."role_permissions" TO "tindio_service";

REVOKE SELECT,INSERT,DELETE ON TABLE "public"."role_permissions" FROM "authenticated";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."role_permissions" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."roles" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."roles" TO "tindio_service";

REVOKE SELECT,INSERT ON TABLE "public"."roles" FROM "authenticated";
GRANT SELECT,INSERT ON TABLE "public"."roles" TO "tindio_authenticated";

REVOKE UPDATE("name") ON TABLE "public"."roles" FROM "authenticated";
GRANT UPDATE("name") ON TABLE "public"."roles" TO "tindio_authenticated";

REVOKE UPDATE("description") ON TABLE "public"."roles" FROM "authenticated";
GRANT UPDATE("description") ON TABLE "public"."roles" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."sale_exchanges" FROM "authenticated";
GRANT SELECT ON TABLE "public"."sale_exchanges" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sale_items" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sale_items" TO "tindio_service";

REVOKE SELECT ON TABLE "public"."sale_items" FROM "authenticated";
GRANT SELECT ON TABLE "public"."sale_items" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sales" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sales" TO "tindio_service";

REVOKE SELECT ON TABLE "public"."sales" FROM "authenticated";
GRANT SELECT ON TABLE "public"."sales" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."shifts" FROM "authenticated";
GRANT SELECT ON TABLE "public"."shifts" TO "tindio_authenticated";

REVOKE SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."smart_menu_categories" FROM "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."smart_menu_categories" TO "tindio_authenticated";

REVOKE SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."smart_menu_products" FROM "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."smart_menu_products" TO "tindio_authenticated";

REVOKE SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."smart_menus" FROM "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."smart_menus" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."stock_request_discrepancies" FROM "authenticated";
GRANT SELECT ON TABLE "public"."stock_request_discrepancies" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."stock_request_lines" FROM "authenticated";
GRANT SELECT ON TABLE "public"."stock_request_lines" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."stock_requests" FROM "authenticated";
GRANT SELECT ON TABLE "public"."stock_requests" TO "tindio_authenticated";

REVOKE SELECT("id") ON TABLE "public"."stock_transfer_lines" FROM "authenticated";
GRANT SELECT("id") ON TABLE "public"."stock_transfer_lines" TO "tindio_authenticated";

REVOKE SELECT("organization_id") ON TABLE "public"."stock_transfer_lines" FROM "authenticated";
GRANT SELECT("organization_id") ON TABLE "public"."stock_transfer_lines" TO "tindio_authenticated";

REVOKE SELECT("stock_transfer_id") ON TABLE "public"."stock_transfer_lines" FROM "authenticated";
GRANT SELECT("stock_transfer_id") ON TABLE "public"."stock_transfer_lines" TO "tindio_authenticated";

REVOKE SELECT("product_id") ON TABLE "public"."stock_transfer_lines" FROM "authenticated";
GRANT SELECT("product_id") ON TABLE "public"."stock_transfer_lines" TO "tindio_authenticated";

REVOKE SELECT("variant_id") ON TABLE "public"."stock_transfer_lines" FROM "authenticated";
GRANT SELECT("variant_id") ON TABLE "public"."stock_transfer_lines" TO "tindio_authenticated";

REVOKE SELECT("quantity") ON TABLE "public"."stock_transfer_lines" FROM "authenticated";
GRANT SELECT("quantity") ON TABLE "public"."stock_transfer_lines" TO "tindio_authenticated";

REVOKE SELECT("received_quantity") ON TABLE "public"."stock_transfer_lines" FROM "authenticated";
GRANT SELECT("received_quantity") ON TABLE "public"."stock_transfer_lines" TO "tindio_authenticated";

REVOKE SELECT("stock_request_line_id") ON TABLE "public"."stock_transfer_lines" FROM "authenticated";
GRANT SELECT("stock_request_line_id") ON TABLE "public"."stock_transfer_lines" TO "tindio_authenticated";

REVOKE SELECT("short_quantity") ON TABLE "public"."stock_transfer_lines" FROM "authenticated";
GRANT SELECT("short_quantity") ON TABLE "public"."stock_transfer_lines" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."stock_transfer_receipt_lines" FROM "authenticated";
GRANT SELECT ON TABLE "public"."stock_transfer_receipt_lines" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."stock_transfer_receipts" FROM "authenticated";
GRANT SELECT ON TABLE "public"."stock_transfer_receipts" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."stock_transfers" FROM "authenticated";
GRANT SELECT ON TABLE "public"."stock_transfers" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."store_payment_methods" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."store_payment_methods" TO "tindio_service";

REVOKE SELECT ON TABLE "public"."store_payment_methods" FROM "authenticated";
GRANT SELECT ON TABLE "public"."store_payment_methods" TO "tindio_authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stores" FROM "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stores" TO "tindio_service";

REVOKE SELECT,INSERT ON TABLE "public"."stores" FROM "authenticated";
GRANT SELECT,INSERT ON TABLE "public"."stores" TO "tindio_authenticated";

REVOKE UPDATE("name") ON TABLE "public"."stores" FROM "authenticated";
GRANT UPDATE("name") ON TABLE "public"."stores" TO "tindio_authenticated";

REVOKE UPDATE("code") ON TABLE "public"."stores" FROM "authenticated";
GRANT UPDATE("code") ON TABLE "public"."stores" TO "tindio_authenticated";

REVOKE UPDATE("address") ON TABLE "public"."stores" FROM "authenticated";
GRANT UPDATE("address") ON TABLE "public"."stores" TO "tindio_authenticated";

REVOKE UPDATE("phone") ON TABLE "public"."stores" FROM "authenticated";
GRANT UPDATE("phone") ON TABLE "public"."stores" TO "tindio_authenticated";

REVOKE UPDATE("is_active") ON TABLE "public"."stores" FROM "authenticated";
GRANT UPDATE("is_active") ON TABLE "public"."stores" TO "tindio_authenticated";

REVOKE SELECT("id") ON TABLE "public"."supplier_return_lines" FROM "authenticated";
GRANT SELECT("id") ON TABLE "public"."supplier_return_lines" TO "tindio_authenticated";

REVOKE SELECT("organization_id") ON TABLE "public"."supplier_return_lines" FROM "authenticated";
GRANT SELECT("organization_id") ON TABLE "public"."supplier_return_lines" TO "tindio_authenticated";

REVOKE SELECT("supplier_return_id") ON TABLE "public"."supplier_return_lines" FROM "authenticated";
GRANT SELECT("supplier_return_id") ON TABLE "public"."supplier_return_lines" TO "tindio_authenticated";

REVOKE SELECT("product_id") ON TABLE "public"."supplier_return_lines" FROM "authenticated";
GRANT SELECT("product_id") ON TABLE "public"."supplier_return_lines" TO "tindio_authenticated";

REVOKE SELECT("variant_id") ON TABLE "public"."supplier_return_lines" FROM "authenticated";
GRANT SELECT("variant_id") ON TABLE "public"."supplier_return_lines" TO "tindio_authenticated";

REVOKE SELECT("quantity") ON TABLE "public"."supplier_return_lines" FROM "authenticated";
GRANT SELECT("quantity") ON TABLE "public"."supplier_return_lines" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."supplier_returns" FROM "authenticated";
GRANT SELECT ON TABLE "public"."supplier_returns" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."suppliers" FROM "authenticated";
GRANT SELECT ON TABLE "public"."suppliers" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."supply_chain_warehouses" FROM "authenticated";
GRANT SELECT ON TABLE "public"."supply_chain_warehouses" TO "tindio_authenticated";

REVOKE SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."tax_rates" FROM "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."tax_rates" TO "tindio_authenticated";

REVOKE SELECT,INSERT,UPDATE ON TABLE "public"."ticket_templates" FROM "authenticated";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."ticket_templates" TO "tindio_authenticated";

REVOKE SELECT ON TABLE "public"."time_clock_entries" FROM "authenticated";
GRANT SELECT ON TABLE "public"."time_clock_entries" TO "tindio_authenticated";

commit;
