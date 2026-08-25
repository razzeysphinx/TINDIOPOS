"use server";

import { revalidatePath } from "next/cache";

import {
  getOrganizationUsage,
  manageOrganizationLifecycle,
  setActiveOrganization,
} from "@/features/organization-readiness/service";
import type {
  OrganizationReadinessActionResult,
  OrganizationUsageResult,
} from "@/features/organization-readiness/organization-readiness-types";

function revalidateOrganizationViews() {
  revalidatePath("/", "layout");
  revalidatePath("/back-office", "layout");
  revalidatePath("/back-office/business-profile");
  revalidatePath("/organization-paused");
  revalidatePath("/pos");
  revalidatePath("/kitchen");
}

export async function selectActiveOrganizationAction(
  organizationId: string,
): Promise<OrganizationReadinessActionResult> {
  const result = await setActiveOrganization(organizationId);

  if (result.ok) {
    revalidateOrganizationViews();
  }

  return result;
}

export async function manageOrganizationLifecycleAction(
  input: unknown,
): Promise<OrganizationReadinessActionResult> {
  const result = await manageOrganizationLifecycle(input);

  if (result.ok) {
    revalidateOrganizationViews();
  }

  return result;
}

export async function getOrganizationUsageAction(
  organizationId: string,
): Promise<OrganizationUsageResult> {
  return getOrganizationUsage(organizationId);
}
