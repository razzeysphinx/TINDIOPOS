import "server-only";

import { moneyInputToMinor } from "@/features/catalog/catalog-money";
import {
  approveManagerApprovalSchema,
  decideManagerApprovalSchema,
  setEmployeePinSchema,
  updateApprovalRuleSchema,
} from "@/features/approvals/approval-schema";
import type { ApprovalActionResult } from "@/features/approvals/approval-types";
import type { BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export function approvalDatabaseMessage(
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

export async function approveManagerApproval(
  context: BusinessContext,
  input: unknown,
): Promise<ApprovalActionResult> {
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

  return { ok: true, message: "Manager approval recorded. Complete the operation now." };
}

export async function decideManagerApproval(
  context: BusinessContext,
  input: unknown,
): Promise<ApprovalActionResult> {
  const parsed = decideManagerApprovalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose whether to approve or reject this request." };

  const supabase = await createClient();
  const database = supabase as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{
      data: Array<{ decision: string }> | null;
      error: { code?: string; message?: string } | null;
    }>;
  };
  const { data, error } = await database.rpc("decide_manager_approval", {
    target_organization_id: context.organization.id,
    target_approval_request_id: parsed.data.approvalRequestId,
    target_decision: parsed.data.decision,
  });
  if (error || !data?.[0]) {
    return {
      ok: false,
      message: approvalDatabaseMessage(error?.code, error?.message, "TINDIO could not record this approval decision."),
    };
  }
  if (data[0].decision === "EXPIRED") {
    return { ok: false, message: "This approval request has expired." };
  }
  if (data[0].decision !== parsed.data.decision) {
    return { ok: false, message: "TINDIO could not confirm this approval decision." };
  }

  return {
    ok: true,
    message: parsed.data.decision === "APPROVED" ? "Refund request approved." : "Refund request rejected.",
  };
}

export async function setEmployeePin(
  context: BusinessContext,
  input: unknown,
): Promise<ApprovalActionResult> {
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

  return { ok: true, message: "PIN saved securely. It is never shown or stored in plain text." };
}

export async function updateApprovalRule(
  context: BusinessContext,
  input: unknown,
): Promise<ApprovalActionResult> {
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

  return { ok: true, message: "Approval rule saved." };
}
