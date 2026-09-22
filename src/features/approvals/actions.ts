"use server";

import { revalidatePath } from "next/cache";
import type {
  ApprovalActionResult,
  ApprovalPreparationResult,
} from "@/features/approvals/approval-types";
import {
  approveManagerApproval,
  decideManagerApproval,
  loadManagerApprovalStatus,
  requestManagerApproval,
  setEmployeePin,
  updateApprovalRule,
} from "@/features/approvals/service";
import { requireBusinessContext } from "@/lib/auth/dal";

export async function setEmployeePinAction(input: unknown): Promise<ApprovalActionResult> {
  const context = await requireBusinessContext();
  const result = await setEmployeePin(context, input);
  if (result.ok) revalidatePath("/back-office/employees");
  return result;
}

export async function approveManagerApprovalAction(
  input: unknown,
): Promise<ApprovalActionResult> {
  const context = await requireBusinessContext();
  const result = await approveManagerApproval(context, input);
  if (result.ok) revalidatePath("/back-office/security");
  return result;
}

export async function decideManagerApprovalAction(input: unknown): Promise<ApprovalActionResult> {
  const context = await requireBusinessContext();
  const result = await decideManagerApproval(context, input);
  if (result.ok) revalidatePath("/back-office/security");
  return result;
}

export async function loadManagerApprovalStatusAction(input: unknown): Promise<import("@/features/approvals/approval-types").ApprovalStatusResult> {
  const context = await requireBusinessContext();
  return loadManagerApprovalStatus(context, input);
}

export async function updateApprovalRuleAction(input: unknown): Promise<ApprovalActionResult> {
  const context = await requireBusinessContext();
  const result = await updateApprovalRule(context, input);
  if (result.ok) revalidatePath("/back-office/security");
  return result;
}

export async function requestManagerApprovalAction(
  input: unknown,
): Promise<ApprovalPreparationResult> {
  const context = await requireBusinessContext();
  const result = await requestManagerApproval(context, input);
  if (result.ok && result.decision === "APPROVAL_REQUIRED") revalidatePath("/back-office/security");
  return result;
}
