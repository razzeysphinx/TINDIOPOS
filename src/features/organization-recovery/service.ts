import "server-only";

import { loadOrganizationRecoverySnapshot } from "@/features/organization-recovery/data";
import { recoveryDrillInputSchema } from "@/features/organization-recovery/organization-recovery-schema";
import type {
  OrganizationRecoveryActionResult,
  RecoveryDrillOutcome,
  RecoveryDrillType,
} from "@/features/organization-recovery/types";
import { requireUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

function recoveryErrorMessage(error: { code?: string; message?: string } | null) {
  if (error?.code === "42501") {
    return "Only an authorized business owner can perform this recovery action.";
  }

  if (error?.code === "22023") {
    return error.message ?? "The recovery details are invalid.";
  }

  return "TINDIO could not complete this recovery action. No backup or business record was changed.";
}

export async function refreshOrganizationRecoverySnapshot(
  organizationId: string,
): Promise<OrganizationRecoveryActionResult> {
  await requireUser();
  const snapshot = await loadOrganizationRecoverySnapshot(organizationId);

  if (!snapshot) {
    return { ok: false, message: "TINDIO could not load backup and recovery readiness for this organization." };
  }

  return { ok: true, message: "Backup and recovery readiness refreshed.", snapshot };
}

export async function recordOrganizationRecoveryDrill(input: {
  organizationId: string;
  drillType: RecoveryDrillType;
  outcome: RecoveryDrillOutcome;
  recoveryPointAt: string;
  durationMinutes: number;
  notes: string;
}): Promise<OrganizationRecoveryActionResult> {
  const parsed = recoveryDrillInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Enter a valid recovery point, a duration of up to seven days, and notes of at least 10 characters.",
    };
  }

  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_organization_recovery_drill", {
    target_organization_id: parsed.data.organizationId,
    target_drill_type: parsed.data.drillType,
    target_outcome: parsed.data.outcome,
    target_recovery_point_at: parsed.data.recoveryPointAt,
    target_duration_minutes: parsed.data.durationMinutes,
    target_notes: parsed.data.notes,
  });

  if (error) {
    return { ok: false, message: recoveryErrorMessage(error) };
  }

  const result = data as { allowed?: boolean; retry_after_seconds?: number } | null;

  if (!result?.allowed) {
    return {
      ok: false,
      message: "Too many recovery-drill records were submitted. Wait a few minutes and try again.",
    };
  }

  const snapshot = await loadOrganizationRecoverySnapshot(parsed.data.organizationId);

  return {
    ok: true,
    message: parsed.data.outcome === "PASSED"
      ? "Recovery drill recorded as passed. Keep the exported file or restored test environment according to your backup procedure."
      : "Recovery drill recorded as failed. Keep the notes and resolve the recovery issue before relying on this procedure.",
    snapshot,
  };
}
