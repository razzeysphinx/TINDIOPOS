"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requestManagerApprovalSchema } from "@/features/approvals/approval-schema";
import type {
  ApprovalActionResult,
  ApprovalPreparationResult,
} from "@/features/approvals/approval-types";
import {
  approvalDatabaseMessage,
  approveManagerApproval,
  decideManagerApproval,
  setEmployeePin,
  updateApprovalRule,
} from "@/features/approvals/service";
import { requireBusinessContext } from "@/lib/auth/dal";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

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

const approvalStatusSchema = z.object({ approvalRequestId: z.uuid() });

export async function loadManagerApprovalStatusAction(input: unknown): Promise<import("@/features/approvals/approval-types").ApprovalStatusResult> {
  const parsed = approvalStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "This approval request is invalid." };
  const context = await requireBusinessContext();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("approval_requests")
    .select("status, expires_at")
    .eq("organization_id", context.organization.id)
    .eq("id", parsed.data.approvalRequestId)
    .maybeSingle();
  if (error || !data) return { ok: false, message: "This approval request is no longer available." };
  const status = data.status === "PENDING" && new Date(data.expires_at).getTime() <= Date.now()
    ? "EXPIRED"
    : data.status;
  return {
    ok: true,
    status: status as "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CONSUMED" | "CANCELLED",
    expiresAt: data.expires_at,
  };
}

export async function updateApprovalRuleAction(input: unknown): Promise<ApprovalActionResult> {
  const context = await requireBusinessContext();
  const result = await updateApprovalRule(context, input);
  if (result.ok) revalidatePath("/back-office/security");
  return result;
}

// Intentionally preserved inline: this entry point revalidates the security
// page only when the database rule returns APPROVAL_REQUIRED (never on
// ALLOWED), so it cannot become a uniform success-only adapter without a
// behavior change. It is also the shared entry point for the sensitive
// refund, cash pay-out, and inventory adjustment domains.
export async function requestManagerApprovalAction(
  input: unknown,
): Promise<ApprovalPreparationResult> {
  const context = await requireBusinessContext();
  const parsed = requestManagerApprovalSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, decision: "DENIED", message: "Check the operation details and reason." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_manager_approval", {
    target_organization_id: context.organization.id,
    target_operation_code: parsed.data.operationCode,
    target_reason: parsed.data.reason,
    target_payload: parsed.data.payload as unknown as Json,
  });
  const result = data?.[0];

  if (error || !result) {
    return {
      ok: false,
      decision: "DENIED",
      message: approvalDatabaseMessage(
        error?.code,
        error?.message,
        "TINDIO could not evaluate the approval rule.",
      ),
    };
  }

  if (result.decision === "ALLOWED") {
    return {
      ok: true,
      decision: "ALLOWED",
      message: result.message,
      data: { approvalRequestId: null, expiresAt: null },
    };
  }

  if (
    result.decision === "APPROVAL_REQUIRED" &&
    result.approval_request_id &&
    result.expires_at
  ) {
    revalidatePath("/back-office/security");
    return {
      ok: true,
      decision: "APPROVAL_REQUIRED",
      message: result.message,
      data: { approvalRequestId: result.approval_request_id, expiresAt: result.expires_at },
    };
  }

  return {
    ok: false,
    decision: "DENIED",
    message: result.message || "This operation is denied by the approval rule.",
  };
}
