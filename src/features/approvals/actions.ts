"use server";

import { revalidatePath } from "next/cache";

import { moneyInputToMinor } from "@/features/catalog/catalog-money";
import {
  approveManagerApprovalSchema,
  requestManagerApprovalSchema,
  setEmployeePinSchema,
  updateApprovalRuleSchema,
} from "@/features/approvals/approval-schema";
import { requireBusinessContext } from "@/lib/auth/dal";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export type ApprovalPreparationResult =
  | {
      ok: true;
      decision: "ALLOWED";
      message: string;
      data: { approvalRequestId: null; expiresAt: null };
    }
  | {
      ok: true;
      decision: "APPROVAL_REQUIRED";
      message: string;
      data: { approvalRequestId: string; expiresAt: string };
    }
  | { ok: false; decision: "DENIED"; message: string };

export type ApprovalActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

function approvalDatabaseMessage(
  code: string | undefined,
  message: string | undefined,
  fallback: string,
) {
  if (code === "42501") {
    return "You are not authorized to perform this approval action.";
  }

  if ((code === "23514" || code === "P0002") && message) {
    return message;
  }

  return fallback;
}

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

export async function approveManagerApprovalAction(
  input: unknown,
): Promise<ApprovalActionResult> {
  const context = await requireBusinessContext();
  const parsed = approveManagerApprovalSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Enter a valid manager employee number and 6–12 digit PIN." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_manager_approval", {
    target_organization_id: context.organization.id,
    target_approval_request_id: parsed.data.approvalRequestId,
    target_approver_employee_number: parsed.data.employeeNumber,
    target_pin: parsed.data.pin,
  });

  if (error || !data?.[0]) {
    return {
      ok: false,
      message:
        error?.code === "42501"
          ? "Manager verification failed, is unavailable, or is temporarily locked."
          : approvalDatabaseMessage(
              error?.code,
              error?.message,
              "TINDIO could not record this manager approval.",
            ),
    };
  }

  revalidatePath("/back-office/security");
  return { ok: true, message: "Manager approval recorded. Complete the operation now." };
}

export async function setEmployeePinAction(input: unknown): Promise<ApprovalActionResult> {
  const context = await requireBusinessContext();
  const parsed = setEmployeePinSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Use a 6–12 digit PIN." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_employee_pin", {
    target_organization_id: context.organization.id,
    target_employee_id: parsed.data.employeeId,
    target_pin: parsed.data.pin,
  });

  if (error) {
    return {
      ok: false,
      message: approvalDatabaseMessage(error.code, error.message, "TINDIO could not set this PIN."),
    };
  }

  revalidatePath("/back-office/employees");
  return { ok: true, message: "PIN saved securely. It is never shown or stored in plain text." };
}

export async function updateApprovalRuleAction(input: unknown): Promise<ApprovalActionResult> {
  const context = await requireBusinessContext();
  const parsed = updateApprovalRuleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the rule and threshold amount." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_approval_rule", {
    target_organization_id: context.organization.id,
    target_operation_code: parsed.data.operationCode,
    target_decision: parsed.data.decision,
    // Nullable threshold: when omitted, the database rule applies regardless
    // of amount. Generated Supabase types currently model this SQL argument
    // as non-nullable.
    target_amount_threshold_minor: (parsed.data.amountThreshold
      ? moneyInputToMinor(parsed.data.amountThreshold)
      : null) as never,
    target_is_enabled: parsed.data.isEnabled,
  });

  if (error) {
    return {
      ok: false,
      message: approvalDatabaseMessage(error.code, error.message, "TINDIO could not save this approval rule."),
    };
  }

  revalidatePath("/back-office/security");
  return { ok: true, message: "Approval rule saved." };
}
