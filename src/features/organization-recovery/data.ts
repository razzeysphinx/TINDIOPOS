import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { OrganizationRecoverySnapshot } from "./types";

export async function loadOrganizationRecoverySnapshot(organizationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_organization_recovery_snapshot", {
    target_organization_id: organizationId,
  });

  if (error || !data) {
    return null;
  }

  return data as OrganizationRecoverySnapshot;
}
