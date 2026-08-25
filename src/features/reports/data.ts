import "server-only";

import type { BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export async function loadReportStores(
  context: BusinessContext,
): Promise<Array<{ id: string; name: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stores")
    .select("id, name")
    .eq("organization_id", context.organization.id)
    .eq("is_active", true)
    .order("name");

  if (error) {
    throw new Error(`Unable to load stores for reporting: ${error.message}`);
  }

  return data ?? [];
}
