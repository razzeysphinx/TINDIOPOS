import { z } from "zod";

export const POS_APPROVAL_REQUEST_PATH = "/api/pos/v2/approvals/request" as const;
export const POS_APPROVAL_DETAIL_PATH_PATTERN = /^\/api\/pos\/v2\/approvals\/([^/]+)\/?$/;
export const POS_APPROVAL_APPROVE_PATH_PATTERN = /^\/api\/pos\/v2\/approvals\/([^/]+)\/approve\/?$/;
export const POS_APPROVAL_REQUEST_RPC = "request_manager_approval" as const;
export const POS_APPROVAL_APPROVE_RPC = "approve_manager_approval" as const;

export const POS_APPROVAL_REQUEST_INVALID_MESSAGE = "Check the operation details and reason." as const;
export const POS_APPROVAL_REQUEST_UNAVAILABLE_MESSAGE = "TINDIO could not evaluate the approval rule." as const;
export const POS_APPROVAL_DENIED_MESSAGE = "This operation is denied by the approval rule." as const;
export const POS_APPROVAL_APPROVE_INVALID_MESSAGE = "Enter a valid manager employee number and 6–12 digit PIN." as const;
export const POS_APPROVAL_APPROVE_UNAVAILABLE_MESSAGE = "TINDIO could not record this manager approval." as const;
export const POS_APPROVAL_MANAGER_VERIFICATION_MESSAGE = "Manager verification failed, is unavailable, or is temporarily locked." as const;
export const POS_APPROVAL_RECORDED_MESSAGE = "Manager approval recorded. Complete the operation now." as const;
export const POS_APPROVAL_STATUS_INVALID_MESSAGE = "This approval request is invalid." as const;
export const POS_APPROVAL_STATUS_UNAVAILABLE_MESSAGE = "This approval request is no longer available." as const;
export const POS_APPROVAL_ACTION_UNAUTHORIZED_MESSAGE = "You are not authorized to perform this approval action." as const;

export const approvalOperationSchema = z.enum(["sales.refund", "cash.pay_out", "inventory.adjust"]);
export const approvalPayloadSchema = z.object({}).catchall(z.unknown());
export const requestManagerApprovalSchema = z.object({
  operationCode: approvalOperationSchema,
  reason: z.string().trim().min(2, "Enter a reason.").max(500),
  payload: approvalPayloadSchema,
});
export const approveManagerApprovalSchema = z.object({
  approvalRequestId: z.uuid(),
  employeeNumber: z.string().trim().min(2).max(32)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Enter a valid employee number.")
    .transform((value) => value.toUpperCase()),
  pin: z.string().regex(/^\d{6,12}$/, "Use a 6–12 digit PIN."),
});
export const approvalStatusSchema = approveManagerApprovalSchema.pick({ approvalRequestId: true });

export type ApprovalOperation = z.infer<typeof approvalOperationSchema>;
export type RequestManagerApprovalValues = z.infer<typeof requestManagerApprovalSchema>;
export type ApproveManagerApprovalValues = z.infer<typeof approveManagerApprovalSchema>;
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CONSUMED" | "CANCELLED";
export type ApprovalPreparationResult =
  | { ok: true; decision: "ALLOWED"; message: string; data: { approvalRequestId: null; expiresAt: null } }
  | { ok: true; decision: "APPROVAL_REQUIRED"; message: string; data: { approvalRequestId: string; expiresAt: string } }
  | { ok: false; decision: "DENIED"; message: string };
export type ApprovalActionResult = { ok: true; message: string } | { ok: false; message: string };
export type ApprovalStatusResult = { ok: true; status: ApprovalStatus; expiresAt: string } | { ok: false; message: string };
