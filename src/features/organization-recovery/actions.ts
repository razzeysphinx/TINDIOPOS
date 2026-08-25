"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

import { loadOrganizationRecoverySnapshot } from "./data";
import type {
  OrganizationRecoverySnapshot,
  RecoveryDrillOutcome,
  RecoveryDrillType,
} from "./types";

const organizationIdSchema = z.string().uuid();
const recoveryDrillInputSchema = z.object({
  organizationId: organizationIdSchema,
  drillType: z.enum(["EXPORT_REVIEW", "LOCAL_RESTORE", "SUPABASE_RESTORE_OR_CLONE"]),
  outcome: z.enum(["PASSED", "FAILED"]),
  recoveryPointAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(0).max(10080),
  notes: z.string().trim().min(10).max(1000),
});

export type OrganizationRecoveryActionResult =
  | { ok: true; message: string; snapshot: OrganizationRecoverySnapshot | null }
  | { ok: false; message: string };

function revalidateRecoveryViews() {
  revalidatePath("/back-office/business-profile");
  revalidatePath("/organization-paused");
}

function recoveryErrorMessage(error: { code?: string; message?: string } | null) {
  if (error?.code === "42501") {
    return "Only an authorized business owner can perform this recovery action.";
  }

  if (error?.code === "22023") {
    return error.message ?? "The recovery details are invalid.";
  }

  return "TINDIO could not complete this recovery action. No backup or business record was changed.";
}

export async function refreshOrganizationRecoverySnapshotAction(
  organizationId: string,
): Promise<OrganizationRecoveryActionResult> {
  if (!organizationIdSchema.safeParse(organizationId).success) {
    return { ok: false, message: "Choose a valid organization." };
  }

  await requireUser();
  const snapshot = await loadOrganizationRecoverySnapshot(organizationId);

  if (!snapshot) {
    return { ok: false, message: "TINDIO could not load backup and recovery readiness for this organization." };
  }

  return { ok: true, message: "Backup and recovery readiness refreshed.", snapshot };
}

export async function recordOrganizationRecoveryDrillAction(
  input: {
    organizationId: string;
    drillType: RecoveryDrillType;
    outcome: RecoveryDrillOutcome;
    recoveryPointAt: string;
    durationMinutes: number;
    notes: string;
  },
): Promise<OrganizationRecoveryActionResult> {
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

  revalidateRecoveryViews();
  const snapshot = await loadOrganizationRecoverySnapshot(parsed.data.organizationId);

  return {
    ok: true,
    message: parsed.data.outcome === "PASSED"
      ? "Recovery drill recorded as passed. Keep the exported file or restored test environment according to your backup procedure."
      : "Recovery drill recorded as failed. Keep the notes and resolve the recovery issue before relying on this procedure.",
    snapshot,
  };
}
