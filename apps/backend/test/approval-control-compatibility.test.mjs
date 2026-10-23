import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVAL_CONTROL_COMPATIBILITY_CONTRACT,
  approvalDatabaseMessage,
  approvalRequestIdFromPath,
  mapApprovalApproveResult,
  mapApprovalRequestResult,
  mapApprovalStatusResult,
  toApprovalApproveRpcArguments,
  toApprovalRequestRpcArguments,
  toApprovalStatusQuery,
  validateApprovalApprove,
  validateApprovalRequest,
  validateApprovalStatus,
} from "../dist/src/pos/approval-control-compatibility.js";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const REQUEST_ID = "10000000-0000-4000-8000-000000000001";

test("approval compatibility freezes all three Web-owned routes and custody dimensions", () => {
  assert.equal(APPROVAL_CONTROL_COMPATIBILITY_CONTRACT.routes.request.path, "/api/pos/v2/approvals/request");
  assert.equal(APPROVAL_CONTROL_COMPATIBILITY_CONTRACT.routes.request.method, "POST");
  assert.equal(APPROVAL_CONTROL_COMPATIBILITY_CONTRACT.routes.approve.method, "POST");
  assert.equal(APPROVAL_CONTROL_COMPATIBILITY_CONTRACT.routes.status.method, "GET");
  assert.deepEqual(APPROVAL_CONTROL_COMPATIBILITY_CONTRACT.custody, ["organization", "requesting-employee", "store", "register", "operation", "approver", "expiry", "status", "payload"]);
});

test("approval dynamic paths retain request identity and reject nested variants", () => {
  assert.equal(approvalRequestIdFromPath(`/api/pos/v2/approvals/${REQUEST_ID}`, "status"), REQUEST_ID);
  assert.equal(approvalRequestIdFromPath(`/api/pos/v2/approvals/${REQUEST_ID}/approve`, "approve"), REQUEST_ID);
  assert.equal(approvalRequestIdFromPath(`/api/pos/v2/approvals/${REQUEST_ID}/approve/nested`, "approve"), null);
});

test("approval request normalizes supported operation and exact RPC projection", () => {
  const parsed = validateApprovalRequest({ operationCode: "cash.pay_out", reason: "  Petty cash  ", payload: { shiftId: REQUEST_ID }, ignored: true });
  assert.equal(parsed.ok, true);
  assert.deepEqual(toApprovalRequestRpcArguments(ORGANIZATION_ID, parsed.input), { target_organization_id: ORGANIZATION_ID, target_operation_code: "cash.pay_out", target_reason: "Petty cash", target_payload: { shiftId: REQUEST_ID } });
});

test("approval request rejects invalid operation, reason, and payload", () => {
  for (const input of [null, { operationCode: "unknown", reason: "Valid", payload: {} }, { operationCode: "sales.refund", reason: "x", payload: {} }, { operationCode: "sales.refund", reason: "Valid", payload: [] }]) {
    assert.deepEqual(validateApprovalRequest(input).body, { ok: false, decision: "DENIED", message: "Check the operation details and reason." });
  }
});

test("approval request maps allowed, pending reuse, denied, and unavailable results", () => {
  assert.deepEqual(mapApprovalRequestResult([{ decision: "ALLOWED", message: "Allowed." }], null), { ok: true, decision: "ALLOWED", message: "Allowed.", data: { approvalRequestId: null, expiresAt: null } });
  assert.deepEqual(mapApprovalRequestResult([{ decision: "APPROVAL_REQUIRED", approval_request_id: REQUEST_ID, expires_at: "2026-10-23T01:00:00.000Z", message: "Manager approval is pending." }], null), { ok: true, decision: "APPROVAL_REQUIRED", message: "Manager approval is pending.", data: { approvalRequestId: REQUEST_ID, expiresAt: "2026-10-23T01:00:00.000Z" } });
  assert.deepEqual(mapApprovalRequestResult([{ decision: "DENIED", message: "Disabled." }], null), { ok: false, decision: "DENIED", message: "Disabled." });
  assert.equal(mapApprovalRequestResult(null, { code: "XX000", message: "private" }).message, "TINDIO could not evaluate the approval rule.");
});

test("manager approval path identity overrides body and normalizes employee number", () => {
  const parsed = validateApprovalApprove(REQUEST_ID, { approvalRequestId: ORGANIZATION_ID, employeeNumber: " mgr_01 ", pin: "123456", ignored: true });
  assert.equal(parsed.ok, true);
  assert.deepEqual(toApprovalApproveRpcArguments(ORGANIZATION_ID, parsed.input), { target_organization_id: ORGANIZATION_ID, target_approval_request_id: REQUEST_ID, target_approver_employee_number: "MGR_01", target_pin: "123456" });
});

test("manager approval preserves bounds, lockout-safe error, and success messages", () => {
  assert.equal(validateApprovalApprove("bad", { employeeNumber: "MGR", pin: "123456" }).body.message, "Enter a valid manager employee number and 6–12 digit PIN.");
  assert.deepEqual(mapApprovalApproveResult(null, { code: "42501", message: "Manager PIN verification failed." }), { ok: false, message: "Manager verification failed, is unavailable, or is temporarily locked." });
  assert.deepEqual(mapApprovalApproveResult([{ approval_request_id: REQUEST_ID }], null), { ok: true, message: "Manager approval recorded. Complete the operation now." });
});

test("approval status query binds organization and request with maybe-single cardinality", () => {
  assert.equal(validateApprovalStatus("bad").body.message, "This approval request is invalid.");
  assert.deepEqual(toApprovalStatusQuery(ORGANIZATION_ID, REQUEST_ID), { table: "approval_requests", columns: "status, expires_at", organizationId: ORGANIZATION_ID, approvalRequestId: REQUEST_ID, cardinality: "maybeSingle" });
});

test("approval status maps pending, expired, terminal, and unavailable states", () => {
  const expiresAt = "2026-10-23T01:00:00.000Z";
  assert.deepEqual(mapApprovalStatusResult({ status: "PENDING", expires_at: expiresAt }, null, Date.parse("2026-10-23T00:00:00.000Z")), { ok: true, status: "PENDING", expiresAt });
  assert.equal(mapApprovalStatusResult({ status: "PENDING", expires_at: expiresAt }, null, Date.parse("2026-10-23T02:00:00.000Z")).status, "EXPIRED");
  assert.equal(mapApprovalStatusResult({ status: "CONSUMED", expires_at: expiresAt }, null).status, "CONSUMED");
  assert.deepEqual(mapApprovalStatusResult(null, null), { ok: false, message: "This approval request is no longer available." });
});

test("approval database messages expose only established business detail", () => {
  assert.equal(approvalDatabaseMessage({ code: "42501", message: "private" }, "fallback"), "You are not authorized to perform this approval action.");
  assert.equal(approvalDatabaseMessage({ code: "23514", message: "This approval request is no longer pending." }, "fallback"), "This approval request is no longer pending.");
  assert.equal(approvalDatabaseMessage({ code: "P0002", message: "The approval request was not found." }, "fallback"), "The approval request was not found.");
  assert.equal(approvalDatabaseMessage({ code: "XX000", message: "private" }, "fallback"), "fallback");
});
