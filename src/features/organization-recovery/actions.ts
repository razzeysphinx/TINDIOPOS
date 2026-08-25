"use server";

import { revalidatePath } from "next/cache";

import {
  recordOrganizationRecoveryDrill,
  refreshOrganizationRecoverySnapshot,
} from "@/features/organization-recovery/service";
import { organizationIdSchema } from "@/features/organization-recovery/organization-recovery-schema";
import type {
  OrganizationRecoveryActionResult,
  RecoveryDrillOutcome,
  RecoveryDrillType,
} from "@/features/organization-recovery/types";

export { type OrganizationRecoveryActionResult } from "@/features/organization-recovery/types";

function revalidateRecoveryViews() {
  revalidatePath("/back-office/business-profile");
  revalidatePath("/organization-paused");
}

export async function refreshOrganizationRecoverySnapshotAction(
  organizationId: string,
): Promise<OrganizationRecoveryActionResult> {
  if (!organizationIdSchema.safeParse(organizationId).success) {
    return { ok: false, message: "Choose a valid organization." };
  }

  const result = await refreshOrganizationRecoverySnapshot(organizationId);
  if (result.ok) {
    revalidateRecoveryViews();
  }

  return result;
}

export async function recordOrganizationRecoveryDrillAction(input: {
  organizationId: string;
  drillType: RecoveryDrillType;
  outcome: RecoveryDrillOutcome;
  recoveryPointAt: string;
  durationMinutes: number;
  notes: string;
}): Promise<OrganizationRecoveryActionResult> {
  const result = await recordOrganizationRecoveryDrill(input);
  if (result.ok) {
    revalidateRecoveryViews();
  }

  return result;
}
