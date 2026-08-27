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
  let query = supabase
    .from("stores")
    .select("id, name")
    .eq("organization_id", context.organization.id)
    .eq("is_active", true)
    .order("name");

  if (!hasOrganizationReportingScope(context)) {
    query = query.in("id", assignedStoreIds);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Unable to load stores for reporting: ${error.message}`);
  }

  return data ?? [];
}
