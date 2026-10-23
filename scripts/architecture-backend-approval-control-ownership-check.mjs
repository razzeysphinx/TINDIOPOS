import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns exactly the three frozen approval-control routes", async () => {
  const [request, approve, status] = await Promise.all([
    read("apps/backend/api/pos/v2/approvals/request.ts"),
    read("apps/backend/api/pos/v2/approvals/[approvalRequestId]/approve.ts"),
    read("apps/backend/api/pos/v2/approvals/[approvalRequestId].ts"),
  ]);
  assert.match(request, /export async function POST/); assert.doesNotMatch(request, /export async function GET/);
  assert.match(approve, /export async function POST/); assert.doesNotMatch(approve, /export async function GET/);
  assert.match(status, /export async function GET/); assert.doesNotMatch(status, /export async function POST/);
  for (const source of [request, approve, status]) {
    assert.match(source, /TINDIO_APPROVAL_CONTROL_MODE/); assert.match(source, /TINDIO_WEB_API_ORIGIN/);
  }
  assert.match(await read("apps/backend/.env.example"), /^TINDIO_APPROVAL_CONTROL_MODE=owned$/m);
});

test("owned approval control preserves context-first authorization and frozen mappings", async () => {
  const source = await read("apps/backend/src/pos/approval-control-owned.ts");
  for (const value of ["verifyClaims", "loadCore", "IDENTITY_UNMAPPED", "validateApprovalRequest", "validateApprovalApprove", "validateApprovalStatus", "mapApprovalRequestResult", "mapApprovalApproveResult", "mapApprovalStatusResult"]) assert.ok(source.includes(value), `missing ${value}`);
  assert.ok(source.indexOf("dependencies.verifyClaims(token)") < source.indexOf("dependencies.loadCore(token"));
  assert.ok(source.indexOf("const context = await loadContext(request") < source.indexOf("body = await request.json()"));
  assert.doesNotMatch(source, /service[_-]?role|DATABASE_URL/i);
});

test("approval-control runtime keeps Auth at Supabase and database work at Neon", async () => {
  const [source, owned] = await Promise.all([
    read("apps/backend/src/pos/approval-control-runtime.ts"),
    read("apps/backend/src/pos/approval-control-owned.ts"),
  ]);
  assert.match(source, /auth\.auth\.getClaims\(token\)/); assert.match(source, /createNeonDataApiFetch/);
  for (const marker of ["get_pos_bootstrap_core_v2", '.from("approval_requests")', '.select("status, expires_at")', ".maybeSingle()"]) assert.ok(source.includes(marker), `missing ${marker}`);
  for (const marker of ["POS_APPROVAL_REQUEST_RPC", "POS_APPROVAL_APPROVE_RPC"]) assert.ok(owned.includes(marker), `missing ${marker}`);
  assert.doesNotMatch(source, /service[_-]?role|DATABASE_URL/i);
});

test("approval-control rollback allowlists three paths and correct methods without ambient credentials", async () => {
  const source = await read("apps/backend/src/pos/approval-control-proxy.ts");
  for (const marker of ["POS_APPROVAL_REQUEST_PATH", "POS_APPROVAL_APPROVE_PATH_PATTERN", "POS_APPROVAL_DETAIL_PATH_PATTERN", "request.arrayBuffer()", "request.method", 'redirect: "manual"', 'cache: "no-store"']) assert.ok(source.includes(marker), `missing ${marker}`);
  assert.doesNotMatch(source, /headers\s*:\s*request\.headers|["']cookie["']|["']x-tindio-device-secret["']/);
});

test("D47 retains Web rollback and leaves shift ownership and stock operations unchanged", async () => {
  const web = await Promise.all([
    "src/app/api/pos/v2/approvals/request/route.ts",
    "src/app/api/pos/v2/approvals/[approvalRequestId]/approve/route.ts",
    "src/app/api/pos/v2/approvals/[approvalRequestId]/route.ts",
  ].map(read));
  for (const source of web) assert.match(source, /getPosV2BusinessContext\(request\)/);
  for (const route of ["open.ts", "close.ts", "custody.ts", "cash-movement.ts"]) assert.match(await read(`apps/backend/api/pos/v2/shifts/${route}`), /TINDIO_SHIFT_CONTROL_MODE/);
  for (const path of ["src/app/api/pos/v2/cart/validate-stock/route.ts", "src/app/api/pos/v2/stock-requests/[stockRequestId]/receive/route.ts"]) assert.match(await read(path), /getPosV2BusinessContext/);
  assert.match(await read("apps/backend/README.md"), /Slice D47 Backend-owned approval control/);
});
