import {
  POS_APPROVAL_ACTION_UNAUTHORIZED_MESSAGE,
  POS_APPROVAL_APPROVE_INVALID_MESSAGE,
  POS_APPROVAL_APPROVE_PATH_PATTERN,
  POS_APPROVAL_APPROVE_RPC,
  POS_APPROVAL_APPROVE_UNAVAILABLE_MESSAGE,
  POS_APPROVAL_DENIED_MESSAGE,
  POS_APPROVAL_DETAIL_PATH_PATTERN,
  POS_APPROVAL_MANAGER_VERIFICATION_MESSAGE,
  POS_APPROVAL_RECORDED_MESSAGE,
  POS_APPROVAL_REQUEST_INVALID_MESSAGE,
  POS_APPROVAL_REQUEST_PATH,
  POS_APPROVAL_REQUEST_RPC,
  POS_APPROVAL_REQUEST_UNAVAILABLE_MESSAGE,
  POS_APPROVAL_STATUS_INVALID_MESSAGE,
  POS_APPROVAL_STATUS_UNAVAILABLE_MESSAGE,
  approvalStatusSchema,
  approveManagerApprovalSchema,
  requestManagerApprovalSchema,
  type ApprovalActionResult,
  type ApprovalPreparationResult,
  type ApprovalStatus,
  type ApprovalStatusResult,
  type ApproveManagerApprovalValues,
  type RequestManagerApprovalValues,
} from "@tindio/contracts/approval-control";

export const APPROVAL_CONTROL_COMPATIBILITY_CONTRACT = {
  authority: "next-route-handlers",
  authentication: "supabase-business-context-before-path-or-json",
  organizationScope: "selected-header-or-authorized-default",
  headers: { "cache-control": "private, no-store" },
  routes: {
    request: { method: "POST", path: POS_APPROVAL_REQUEST_PATH, rpc: POS_APPROVAL_REQUEST_RPC },
    approve: { method: "POST", pathPattern: POS_APPROVAL_APPROVE_PATH_PATTERN, rpc: POS_APPROVAL_APPROVE_RPC },
    status: { method: "GET", pathPattern: POS_APPROVAL_DETAIL_PATH_PATTERN, table: "approval_requests" },
  },
  custody: ["organization", "requesting-employee", "store", "register", "operation", "approver", "expiry", "status", "payload"],
  retainedAuthority: ["approval-rule", "store-scope", "manager-permissions", "separation-of-duties", "pin-lockout", "pending-request-reuse", "audit-log"],
} as const;

type DatabaseError = { code?: string; message?: string } | null;
type Failure<T> = { ok: false; body: T };
const failure = <T>(body: T): Failure<T> => ({ ok: false, body });

export function approvalDatabaseMessage(error: DatabaseError, fallback: string): string {
  if (error?.code === "42501") return POS_APPROVAL_ACTION_UNAUTHORIZED_MESSAGE;
  if ((error?.code === "23514" || error?.code === "P0002") && error.message) return error.message;
  return fallback;
}

export function approvalRequestIdFromPath(pathname: string, action: "approve" | "status"): string | null {
  const match = (action === "approve" ? POS_APPROVAL_APPROVE_PATH_PATTERN : POS_APPROVAL_DETAIL_PATH_PATTERN).exec(pathname);
  return match?.[1] ?? null;
}

export function validateApprovalRequest(input: unknown) {
  const parsed = requestManagerApprovalSchema.safeParse(input);
  return parsed.success ? { ok: true as const, input: parsed.data } : failure<ApprovalPreparationResult>({ ok: false, decision: "DENIED", message: POS_APPROVAL_REQUEST_INVALID_MESSAGE });
}

export function toApprovalRequestRpcArguments(organizationId: string, input: RequestManagerApprovalValues) {
  return { target_organization_id: organizationId, target_operation_code: input.operationCode, target_reason: input.reason, target_payload: input.payload };
}

export function mapApprovalRequestResult(data: Array<Record<string, unknown>> | null, error: DatabaseError): ApprovalPreparationResult {
  const result = data?.[0];
  if (error || !result) return { ok: false, decision: "DENIED", message: approvalDatabaseMessage(error, POS_APPROVAL_REQUEST_UNAVAILABLE_MESSAGE) };
  if (result.decision === "ALLOWED") return { ok: true, decision: "ALLOWED", message: String(result.message), data: { approvalRequestId: null, expiresAt: null } };
  if (result.decision === "APPROVAL_REQUIRED" && result.approval_request_id && result.expires_at) return { ok: true, decision: "APPROVAL_REQUIRED", message: String(result.message), data: { approvalRequestId: String(result.approval_request_id), expiresAt: String(result.expires_at) } };
  return { ok: false, decision: "DENIED", message: typeof result.message === "string" && result.message ? result.message : POS_APPROVAL_DENIED_MESSAGE };
}

export function validateApprovalApprove(approvalRequestId: string, input: unknown) {
  const body = input && typeof input === "object" ? input : {};
  const parsed = approveManagerApprovalSchema.safeParse({ ...body, approvalRequestId });
  return parsed.success ? { ok: true as const, input: parsed.data } : failure<ApprovalActionResult>({ ok: false, message: POS_APPROVAL_APPROVE_INVALID_MESSAGE });
}

export function toApprovalApproveRpcArguments(organizationId: string, input: ApproveManagerApprovalValues) {
  return { target_organization_id: organizationId, target_approval_request_id: input.approvalRequestId, target_approver_employee_number: input.employeeNumber, target_pin: input.pin };
}

export function mapApprovalApproveResult(data: Array<Record<string, unknown>> | null, error: DatabaseError): ApprovalActionResult {
  if (error || !data?.[0]) return { ok: false, message: error?.code === "42501" ? POS_APPROVAL_MANAGER_VERIFICATION_MESSAGE : approvalDatabaseMessage(error, POS_APPROVAL_APPROVE_UNAVAILABLE_MESSAGE) };
  return { ok: true, message: POS_APPROVAL_RECORDED_MESSAGE };
}

export function validateApprovalStatus(approvalRequestId: string) {
  const parsed = approvalStatusSchema.safeParse({ approvalRequestId });
  return parsed.success ? { ok: true as const, input: parsed.data } : failure<ApprovalStatusResult>({ ok: false, message: POS_APPROVAL_STATUS_INVALID_MESSAGE });
}

export function toApprovalStatusQuery(organizationId: string, approvalRequestId: string) {
  return { table: "approval_requests" as const, columns: "status, expires_at" as const, organizationId, approvalRequestId, cardinality: "maybeSingle" as const };
}

export function mapApprovalStatusResult(data: Record<string, unknown> | null, error: DatabaseError, now = Date.now()): ApprovalStatusResult {
  if (error || !data) return { ok: false, message: POS_APPROVAL_STATUS_UNAVAILABLE_MESSAGE };
  const status = data.status === "PENDING" && new Date(String(data.expires_at)).getTime() <= now ? "EXPIRED" : data.status;
  return { ok: true, status: status as ApprovalStatus, expiresAt: data.expires_at as string };
}
