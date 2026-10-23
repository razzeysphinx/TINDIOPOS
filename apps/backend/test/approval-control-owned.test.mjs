import assert from "node:assert/strict";
import test from "node:test";
import { handleOwnedApprovalControl } from "../dist/src/pos/approval-control-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_ID = "10000000-0000-4000-8000-000000000001";
const EMPLOYEE_ID = "20000000-0000-4000-8000-000000000001";
const STORE_ID = "30000000-0000-4000-8000-000000000001";
const REQUEST_ID = "40000000-0000-4000-8000-000000000001";
const EXPIRES_AT = "2026-10-23T01:00:00.000Z";

function core(overrides = {}) {
  return {
    ok: true, profileId: PROFILE_ID,
    organization: { id: ORGANIZATION_ID, name: "TINDIO", currencyCode: "PHP", timezone: "Asia/Manila", status: "active", businessType: "retail", deviceManagementEnabled: true },
    employee: { id: EMPLOYEE_ID, employeeNumber: "EMP-1", jobTitle: "Cashier", name: "Cashier" },
    availableOrganizations: [{ id: ORGANIZATION_ID, name: "TINDIO", status: "active" }],
    roleNames: ["Cashier"], permissions: ["approvals.request"], storeIds: [STORE_ID], features: {}, ...overrides,
  };
}
function dependencies(overrides = {}) {
  return {
    verifyClaims: async () => ({ data: { claims: { sub: PROFILE_ID } }, error: null }),
    loadCore: async () => ({ data: core(), error: null }),
    rpc: async () => ({ data: null, error: null }),
    loadStatus: async () => ({ data: null, error: null }),
    ...overrides,
  };
}
function request(path, method = "POST", body = {}, headers = {}) {
  return new Request(`https://backend.test${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, ...(method === "POST" ? { "content-type": "application/json" } : {}), ...headers },
    ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}
async function assertBody(response, status, body) {
  assert.equal(response.status, status); assert.deepEqual(await response.json(), body);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
}

test("owned approval control requires a bounded bearer before context or JSON", async () => {
  let loaded = 0;
  const response = await handleOwnedApprovalControl(new Request("https://backend.test/api/pos/v2/approvals/request", { method: "POST", body: "{" }), "request", dependencies({ loadCore: async () => { loaded += 1; return { data: core(), error: null }; } }));
  assert.equal(loaded, 0); await assertBody(response, 401, { ok: false, reason: "AUTH_REQUIRED" });
});

test("owned approval control preserves Auth classifications", async () => {
  const invalid = await handleOwnedApprovalControl(request("/api/pos/v2/approvals/request"), "request", dependencies({ verifyClaims: async () => ({ data: null, error: null }) }));
  await assertBody(invalid, 401, { ok: false, reason: "AUTH_INVALID" });
  const unavailable = await handleOwnedApprovalControl(request("/api/pos/v2/approvals/request"), "request", dependencies({ verifyClaims: async () => { throw new Error("offline"); } }));
  await assertBody(unavailable, 503, { ok: false, reason: "AUTH_PROVIDER_UNAVAILABLE" });
});

test("owned approval control preserves organization selection and identity retry", async () => {
  const organizations = [];
  const response = await handleOwnedApprovalControl(request("/api/pos/v2/approvals/request", "POST", { operationCode: "sales.refund", reason: "Return", payload: {} }, { "x-tindio-organization-id": ORGANIZATION_ID }), "request", dependencies({
    loadCore: async (_token, organizationId) => { organizations.push(organizationId); return organizations.length === 1 ? { data: { ok: false, reason: "IDENTITY_UNMAPPED" }, error: null } : { data: core(), error: null }; },
    rpc: async () => ({ data: [{ decision: "ALLOWED", message: "Allowed." }], error: null }),
  }));
  assert.deepEqual(organizations, [ORGANIZATION_ID, ORGANIZATION_ID]);
  assert.deepEqual(await response.json(), { ok: true, decision: "ALLOWED", message: "Allowed.", data: { approvalRequestId: null, expiresAt: null } });
});

test("owned approval control resolves context before malformed JSON", async () => {
  const events = [];
  const response = await handleOwnedApprovalControl(request("/api/pos/v2/approvals/request", "POST", "{"), "request", dependencies({
    verifyClaims: async () => { events.push("claims"); return { data: { claims: { sub: PROFILE_ID } }, error: null }; },
    loadCore: async () => { events.push("core"); return { data: core(), error: null }; },
  }));
  assert.deepEqual(events, ["claims", "core"]);
  await assertBody(response, 400, { ok: false, message: "The request data is invalid." });
});

test("owned approval request validates and sends the exact tenant RPC projection", async () => {
  await assertBody(await handleOwnedApprovalControl(request("/api/pos/v2/approvals/request", "POST", { operationCode: "bad", reason: "x", payload: [] }), "request", dependencies()), 200, { ok: false, decision: "DENIED", message: "Check the operation details and reason." });
  let observed;
  const response = await handleOwnedApprovalControl(request("/api/pos/v2/approvals/request", "POST", { operationCode: "cash.pay_out", reason: "  Petty cash  ", payload: { shiftId: REQUEST_ID }, ignored: true }), "request", dependencies({
    rpc: async (...args) => { observed = args; return { data: [{ decision: "APPROVAL_REQUIRED", approval_request_id: REQUEST_ID, expires_at: EXPIRES_AT, message: "Manager approval is pending." }], error: null }; },
  }));
  assert.deepEqual(observed, [TOKEN, "request_manager_approval", { target_organization_id: ORGANIZATION_ID, target_operation_code: "cash.pay_out", target_reason: "Petty cash", target_payload: { shiftId: REQUEST_ID } }]);
  assert.deepEqual(await response.json(), { ok: true, decision: "APPROVAL_REQUIRED", message: "Manager approval is pending.", data: { approvalRequestId: REQUEST_ID, expiresAt: EXPIRES_AT } });
});

test("owned manager approval lets path identity override body and preserves lockout-safe failures", async () => {
  let observed;
  const path = `/api/pos/v2/approvals/${REQUEST_ID}/approve`;
  const response = await handleOwnedApprovalControl(request(path, "POST", { approvalRequestId: ORGANIZATION_ID, employeeNumber: " mgr_01 ", pin: "123456" }), "approve", dependencies({
    rpc: async (...args) => { observed = args; return { data: [{ approval_request_id: REQUEST_ID }], error: null }; },
  }));
  assert.deepEqual(observed, [TOKEN, "approve_manager_approval", { target_organization_id: ORGANIZATION_ID, target_approval_request_id: REQUEST_ID, target_approver_employee_number: "MGR_01", target_pin: "123456" }]);
  assert.deepEqual(await response.json(), { ok: true, message: "Manager approval recorded. Complete the operation now." });
  const denied = await handleOwnedApprovalControl(request(path, "POST", { employeeNumber: "MGR_01", pin: "123456" }), "approve", dependencies({ rpc: async () => ({ data: null, error: { code: "42501", message: "private" } }) }));
  assert.deepEqual(await denied.json(), { ok: false, message: "Manager verification failed, is unavailable, or is temporarily locked." });
});

test("owned approval status binds organization and request then derives expiry", async () => {
  let observed;
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-10-23T02:00:00.000Z");
  try {
    const response = await handleOwnedApprovalControl(request(`/api/pos/v2/approvals/${REQUEST_ID}`, "GET"), "status", dependencies({
      loadStatus: async (...args) => { observed = args; return { data: { status: "PENDING", expires_at: EXPIRES_AT }, error: null }; },
    }));
    assert.deepEqual(observed, [TOKEN, ORGANIZATION_ID, REQUEST_ID]);
    assert.deepEqual(await response.json(), { ok: true, status: "EXPIRED", expiresAt: EXPIRES_AT });
  } finally { Date.now = originalNow; }
});

test("owned approval control preserves invalid paths and unavailable provider envelopes", async () => {
  const invalid = await handleOwnedApprovalControl(request("/api/pos/v2/approvals/not-a-uuid", "GET"), "status", dependencies());
  assert.deepEqual(await invalid.json(), { ok: false, message: "This approval request is invalid." });
  const requestFailure = await handleOwnedApprovalControl(request("/api/pos/v2/approvals/request", "POST", { operationCode: "inventory.adjust", reason: "Count", payload: {} }), "request", dependencies({ rpc: async () => { throw new Error("offline"); } }));
  assert.deepEqual(await requestFailure.json(), { ok: false, decision: "DENIED", message: "TINDIO could not evaluate the approval rule." });
  const statusFailure = await handleOwnedApprovalControl(request(`/api/pos/v2/approvals/${REQUEST_ID}`, "GET"), "status", dependencies({ loadStatus: async () => { throw new Error("offline"); } }));
  assert.deepEqual(await statusFailure.json(), { ok: false, message: "This approval request is no longer available." });
});
