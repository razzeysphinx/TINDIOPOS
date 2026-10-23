import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("approval-control contract is focused and platform-neutral", async () => {
  const [manifestSource, index, contract] = await Promise.all([read("packages/contracts/package.json"), read("packages/contracts/src/index.ts"), read("packages/contracts/src/approval-control.ts")]);
  const manifest = JSON.parse(manifestSource);
  assert.equal(manifest.exports["./approval-control"].types, "./src/approval-control.ts");
  assert.match(index, /export \* from "\.\/approval-control"/);
  for (const value of ["POS_APPROVAL_REQUEST_PATH", "POS_APPROVAL_DETAIL_PATH_PATTERN", "POS_APPROVAL_APPROVE_PATH_PATTERN", "requestManagerApprovalSchema", "approveManagerApprovalSchema", "approvalStatusSchema"]) assert.match(contract, new RegExp(`\\b${value}\\b`));
  assert.doesNotMatch(contract, /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/);
});

test("all three Web routes retain context-first authority and shared schemas", async () => {
  const [requestRoute, approveRoute, statusRoute, schema, service] = await Promise.all([
    read("src/app/api/pos/v2/approvals/request/route.ts"),
    read("src/app/api/pos/v2/approvals/[approvalRequestId]/approve/route.ts"),
    read("src/app/api/pos/v2/approvals/[approvalRequestId]/route.ts"),
    read("src/features/approvals/approval-schema.ts"),
    read("src/features/approvals/service.ts"),
  ]);
  for (const source of [requestRoute, approveRoute, statusRoute]) assert.match(source, /getPosV2BusinessContext\(request\)/);
  assert.ok(requestRoute.indexOf("getPosV2BusinessContext(request)") < requestRoute.indexOf("readPosApiJson(request)"));
  assert.ok(approveRoute.indexOf("getPosV2BusinessContext(request)") < approveRoute.indexOf("readPosApiJson(request)"));
  assert.ok(statusRoute.indexOf("getPosV2BusinessContext(request)") < statusRoute.indexOf("await params"));
  assert.match(schema, /@tindio\/contracts\/approval-control/);
  for (const marker of ["request_manager_approval", "approve_manager_approval", '.from("approval_requests")', '.select("status, expires_at")', ".maybeSingle()", "Date.now()"] ) assert.ok(service.includes(marker), `missing ${marker}`);
});

test("Backend approval oracle remains isolated beside D47 ownership", async () => {
  const oracle = await read("apps/backend/src/pos/approval-control-compatibility.ts");
  for (const value of ["APPROVAL_CONTROL_COMPATIBILITY_CONTRACT", "validateApprovalRequest", "mapApprovalRequestResult", "validateApprovalApprove", "mapApprovalApproveResult", "validateApprovalStatus", "mapApprovalStatusResult"]) assert.match(oracle, new RegExp(`\\b${value}\\b`));
  assert.doesNotMatch(oracle, /fetch\(|createNeonDataApiFetch|@supabase|@neon|process\.env/);
  for (const path of ["request.ts", "[approvalRequestId].ts", "[approvalRequestId]/approve.ts"]) assert.equal(existsSync(new URL(`../apps/backend/api/pos/v2/approvals/${path}`, import.meta.url)), true, `${path} must be owned in D47`);
});

test("database authority retains approval rule, actor, store, expiry, PIN, and audit custody", async () => {
  const baseline = (await read("database/baseline/0001_tindio_baseline.sql")).toLowerCase();
  for (const marker of [
    "private.current_employee_id(target_organization_id)", "private.has_permission(target_organization_id, 'approvals.request')",
    "private.resolve_approval_context", "private.has_store_read_scope", "private.approval_decision",
    "request.request_payload = target_payload", "request.expires_at > now()", "'approval_requested'",
    "request.requested_by_employee_id is distinct from requester_employee_id", "approver.id = requester_employee_id",
    "'approvals.authorize'", "private.employee_pin_credentials", "failed_attempts = least(next_failed_attempts, 5)",
    "status = 'approved'", "'approval_approved'",
  ]) assert.ok(baseline.includes(marker), `missing ${marker}`);
  assert.ok(baseline.includes('grant all on function "public"."request_manager_approval"'));
  assert.ok(baseline.includes('grant all on function "public"."approve_manager_approval"'));
});

test("D45 ownership remains and stock routes stay in Web", async () => {
  const shifts = await Promise.all(["open.ts", "close.ts", "custody.ts", "cash-movement.ts"].map((route) => read(`apps/backend/api/pos/v2/shifts/${route}`)));
  for (const source of shifts) assert.match(source, /export async function POST/);
  for (const path of ["src/app/api/pos/v2/cart/validate-stock/route.ts", "src/app/api/pos/v2/stock-requests/[stockRequestId]/receive/route.ts"]) assert.match(await read(path), /getPosV2BusinessContext/);
  assert.match(await read("apps/backend/README.md"), /Slice D46 approval-control compatibility oracle/);
});
