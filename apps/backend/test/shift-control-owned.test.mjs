import assert from "node:assert/strict";
import test from "node:test";
import { handleOwnedShiftControl } from "../dist/src/pos/shift-control-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_ID = "10000000-0000-4000-8000-000000000001";
const EMPLOYEE_ID = "20000000-0000-4000-8000-000000000001";
const STORE_ID = "30000000-0000-4000-8000-000000000001";
const REGISTER_ID = "40000000-0000-4000-8000-000000000001";
const SHIFT_ID = "50000000-0000-4000-8000-000000000001";
const DEVICE_ID = "60000000-0000-4000-8000-000000000001";
const KEY = "70000000-0000-4000-8000-000000000001";
const FINALIZATION = "80000000-0000-4000-8000-000000000001";
const DEVICE = { deviceId: DEVICE_ID, secret: "a".repeat(64), appVersion: "mobile-1.0.0" };

function core(overrides = {}) {
  return {
    ok: true, profileId: PROFILE_ID,
    organization: { id: ORGANIZATION_ID, name: "TINDIO", currencyCode: "PHP", timezone: "Asia/Manila", status: "active", businessType: "retail", deviceManagementEnabled: true },
    employee: { id: EMPLOYEE_ID, employeeNumber: "EMP-1", jobTitle: "Cashier", name: "Cashier" },
    availableOrganizations: [{ id: ORGANIZATION_ID, name: "TINDIO", status: "active" }],
    roleNames: ["Cashier"], permissions: ["shifts.open", "shifts.close", "cash.pay_in", "cash.pay_out"], storeIds: [STORE_ID], features: {}, ...overrides,
  };
}
function dependencies(overrides = {}) {
  return {
    verifyClaims: async () => ({ data: { claims: { sub: PROFILE_ID } }, error: null }),
    loadCore: async () => ({ data: core(), error: null }),
    rpc: async () => ({ data: null, error: null }),
    ...overrides,
  };
}
function request(path, body, headers = {}) {
  return new Request(`https://backend.test${path}`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
async function assertBody(response, status, body) { assert.equal(response.status, status); assert.deepEqual(await response.json(), body); assert.equal(response.headers.get("cache-control"), "private, no-store"); }

test("owned shift control requires a bounded bearer before context or JSON", async () => {
  let loaded = 0;
  const response = await handleOwnedShiftControl(new Request("https://backend.test/api/pos/v2/shifts/open", { method: "POST", body: "{" }), "open", dependencies({ loadCore: async () => { loaded += 1; return { data: core(), error: null }; } }));
  assert.equal(loaded, 0); await assertBody(response, 401, { ok: false, reason: "AUTH_REQUIRED" });
});

test("owned shift control preserves organization selection and identity retry", async () => {
  const organizations = [];
  const response = await handleOwnedShiftControl(request("/api/pos/v2/shifts/open", { storeId: STORE_ID, registerId: REGISTER_ID, openingCash: "0.00" }, { "x-tindio-organization-id": ORGANIZATION_ID }), "open", dependencies({
    loadCore: async (_token, organizationId) => { organizations.push(organizationId); return organizations.length === 1 ? { data: { ok: false, reason: "IDENTITY_UNMAPPED" }, error: null } : { data: core(), error: null }; },
    rpc: async () => ({ data: [{ shift_id: SHIFT_ID, opened_at: "2026-10-23T00:00:00.000Z", was_replayed: false }], error: null }),
  }));
  assert.deepEqual(organizations, [ORGANIZATION_ID, ORGANIZATION_ID]); assert.equal(response.status, 200); assert.equal((await response.json()).ok, true);
});

test("owned shift control resolves context before malformed JSON", async () => {
  const events = [];
  const response = await handleOwnedShiftControl(request("/api/pos/v2/shifts/open", "{"), "open", dependencies({
    verifyClaims: async () => { events.push("claims"); return { data: { claims: { sub: PROFILE_ID } }, error: null }; },
    loadCore: async () => { events.push("core"); return { data: core(), error: null }; },
  }));
  assert.deepEqual(events, ["claims", "core"]); await assertBody(response, 400, { ok: false, message: "The request data is invalid." });
});

test("owned shift open preserves permission precedence, exact RPC, device custody, and replay", async () => {
  const input = { storeId: STORE_ID, registerId: REGISTER_ID, openingCash: "12.30", openingNote: " Ready ", device: DEVICE };
  await assertBody(await handleOwnedShiftControl(request("/api/pos/v2/shifts/open", input), "open", dependencies({ loadCore: async () => ({ data: core({ permissions: [] }), error: null }) })), 200, { ok: false, message: "You do not have permission to open register shifts." });
  let observed;
  const response = await handleOwnedShiftControl(request("/api/pos/v2/shifts/open", input), "open", dependencies({ rpc: async (...args) => { observed = args; return { data: [{ shift_id: SHIFT_ID, opened_at: "2026-10-23T00:00:00.000Z", was_replayed: true }], error: null }; } }));
  assert.deepEqual(observed, [TOKEN, "open_register_shift", { target_organization_id: ORGANIZATION_ID, target_store_id: STORE_ID, target_register_id: REGISTER_ID, target_opening_cash_minor: 1230, target_opening_note: "Ready" }, DEVICE]);
  assert.equal((await response.json()).message, "This shift is already open.");
});

test("owned mobile close preserves 426 upgrade before mutation", async () => {
  let calls = 0;
  const response = await handleOwnedShiftControl(request("/api/pos/v2/shifts/close", { shiftId: SHIFT_ID, countedCash: "10.00" }), "close", dependencies({ rpc: async () => { calls += 1; return { data: null, error: null }; } }));
  assert.equal(calls, 0); assert.equal(response.status, 426); assert.equal((await response.json()).code, "POS_CLIENT_UPGRADE_REQUIRED");
});

test("owned mobile close sends checkpoint custody and maps pending then replay", async () => {
  const input = { shiftId: SHIFT_ID, countedCash: "10.00", closingNote: " Closed ", device: DEVICE, localHighWater: 9, finalizationToken: FINALIZATION };
  let observed;
  const pending = await handleOwnedShiftControl(request("/api/pos/v2/shifts/close", input), "close", dependencies({ rpc: async (...args) => { observed = args; return { data: [{ closed: false }], error: null }; } }));
  assert.deepEqual(observed, [TOKEN, "close_register_shift_mobile", { target_organization_id: ORGANIZATION_ID, target_shift_id: SHIFT_ID, target_counted_cash_minor: 1000, target_closing_note: "Closed", target_local_high_water: 9, target_finalization_token: FINALIZATION }, DEVICE]);
  assert.match((await pending.json()).message, /another device still has offline transaction custody/);
  const replay = await handleOwnedShiftControl(request("/api/pos/v2/shifts/close", input), "close", dependencies({ rpc: async () => ({ data: [{ closed: true, was_replayed: true, expected_cash_minor: "1200", counted_cash_minor: "1000", difference_minor: "-200" }], error: null }) }));
  assert.deepEqual(await replay.json(), { ok: true, message: "This shift close was already recorded.", closeSummary: { expectedCashMinor: 1200, countedCashMinor: 1000, differenceMinor: -200 } });
});

test("owned shift custody binds the authenticated device result", async () => {
  const input = { shiftId: SHIFT_ID, device: DEVICE };
  let observed;
  const response = await handleOwnedShiftControl(request("/api/pos/v2/shifts/custody", input), "custody", dependencies({ rpc: async (...args) => { observed = args; return { data: [{ device_id: DEVICE_ID, shift_id: SHIFT_ID }], error: null }; } }));
  assert.deepEqual(observed, [TOKEN, "acquire_pos_shift_custody", { target_organization_id: ORGANIZATION_ID, target_shift_id: SHIFT_ID }, DEVICE]);
  assert.deepEqual(await response.json(), { ok: true, deviceId: DEVICE_ID, shiftId: SHIFT_ID, state: "ACTIVE" });
});

test("owned cash movement preserves validation, approval fallback, idempotency, and replay", async () => {
  const input = { shiftId: SHIFT_ID, movementType: "PAY_OUT", amount: "5.25", reason: " Petty cash ", idempotencyKey: KEY };
  await assertBody(await handleOwnedShiftControl(request("/api/pos/v2/shifts/cash-movement", input), "cashMovement", dependencies({ loadCore: async () => ({ data: core({ permissions: [] }), error: null }) })), 200, { ok: false, message: "You do not have permission for this cash movement." });
  let observed;
  const approved = { ...input, approvalRequestId: FINALIZATION };
  const response = await handleOwnedShiftControl(request("/api/pos/v2/shifts/cash-movement", approved), "cashMovement", dependencies({ loadCore: async () => ({ data: core({ permissions: [] }), error: null }), rpc: async (...args) => { observed = args; return { data: [{ was_replayed: true }], error: null }; } }));
  assert.deepEqual(observed, [TOKEN, "record_cash_movement", { target_organization_id: ORGANIZATION_ID, target_shift_id: SHIFT_ID, target_movement_type: "PAY_OUT", target_amount_minor: 525, target_reason: "Petty cash", target_idempotency_key: KEY, target_approval_request_id: FINALIZATION }]);
  assert.deepEqual(await response.json(), { ok: true, message: "That cash movement was already recorded." });
});

test("owned shift control hides unexpected provider detail behind frozen failures", async () => {
  const response = await handleOwnedShiftControl(request("/api/pos/v2/shifts/open", { storeId: STORE_ID, registerId: REGISTER_ID, openingCash: "1.00" }), "open", dependencies({ rpc: async () => ({ data: null, error: { code: "XX000", message: "private" } }) }));
  await assertBody(response, 200, { ok: false, message: "TINDIO could not open this register shift." });
});
