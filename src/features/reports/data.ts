import "server-only";

import { hasOrganizationReportingScope } from "@/features/reports/reporting";
import type { BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export async function loadReportStores(
  context: BusinessContext,
): Promise<Array<{ id: string; name: string }>> {
  const assignedStoreIds = [...new Set(context.storeIds)];

  if (!hasOrganizationReportingScope(context) && assignedStoreIds.length === 0) {
    return [];
  }

  const supabase = await createClient();
  const { data, error } = await (supabase as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc("get_reports_store_reference_v1", {
    target_organization_id: context.organization.id,
    target_store_ids: hasOrganizationReportingScope(context) ? null : assignedStoreIds,
  });

  if (error) {
    throw new Error(`Unable to load stores for reporting: ${error.message}`);
  }

  return Array.isArray(data)
    ? data.flatMap((row) => row && typeof row === "object" && !Array.isArray(row) && typeof row.id === "string" && typeof row.name === "string" ? [{ id: row.id, name: row.name }] : [])
    : [];
}
