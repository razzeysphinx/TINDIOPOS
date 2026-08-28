import "server-only";

import { approvalOperationSchema } from "@/features/approvals/approval-schema";
import type { SecurityOverview } from "@/features/approvals/approval-types";
import type { BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export async function loadSecurityOverview(
  context: BusinessContext,
  options: { includeAudit?: boolean; storeId?: string | null } = {},
): Promise<SecurityOverview> {
  const supabase = await createClient();
  const organizationId = context.organization.id;

  let auditQuery = supabase
    .from("audit_logs")
    .select("id, store_id, register_id, event_type, operation_code, amount_minor, reason, actor_employee_id, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (options.storeId) auditQuery = auditQuery.eq("store_id", options.storeId);

  const [rulesResult, requestsResult, auditResult, employeesResult] = await Promise.all([
    supabase
      .from("approval_rules")
      .select("operation_code, decision, amount_threshold_minor, is_enabled")
      .eq("organization_id", organizationId)
      .in("operation_code", approvalOperationSchema.options)
      .order("operation_code"),
    supabase
      .from("approval_requests")
      .select("id, operation_code, status, requested_amount_minor, reason, requested_by_employee_id, approved_by_employee_id, requested_at, decided_at, expires_at")
      .eq("organization_id", organizationId)
      .order("requested_at", { ascending: false })
      .limit(20),
    options.includeAudit ? auditQuery : Promise.resolve({ data: [], error: null }),
    supabase.from("employees").select("id, employee_number").eq("organization_id", organizationId),
  ]);

  const error = [rulesResult, requestsResult, auditResult, employeesResult].find(
    (result) => result.error,
  )?.error;
  if (error) throw new Error(`Unable to load security controls: ${error.message}`);

  return {
    rules: rulesResult.data ?? [],
    requests: requestsResult.data ?? [],
    auditEntries: auditResult.data ?? [],
    employees: employeesResult.data ?? [],
  };
}
