import assert from "node:assert/strict";
import test from "node:test";

import { handleOwnedAttendanceMutation } from "../dist/src/pos/attendance-mutation-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_ID = "10000000-0000-4000-8000-000000000001";
const EMPLOYEE_ID = "20000000-0000-4000-8000-000000000001";
const STORE_ID = "30000000-0000-4000-8000-000000000001";
const OTHER_STORE_ID = "30000000-0000-4000-8000-000000000002";
const REQUEST_ID = "40000000-0000-4000-8000-000000000001";
const ENTRY_ID = "50000000-0000-4000-8000-000000000001";
const SHIFT_ID = "60000000-0000-4000-8000-000000000001";
const REGISTER_ID = "70000000-0000-4000-8000-000000000001";

function core(overrides = {}) {
  return {
    ok: true,
    profileId: PROFILE_ID,
    organization: {
      id: ORGANIZATION_ID,
      name: "TINDIO",
      currencyCode: "PHP",
      timezone: "Asia/Manila",
      status: "active",
      businessType: "retail",
      deviceManagementEnabled: true,
    },
    employee: {
      id: EMPLOYEE_ID,
      employeeNumber: "EMP-1",
      jobTitle: "Cashier",
      name: "Cashier",
    },
    availableOrganizations: [{ id: ORGANIZATION_ID, name: "TINDIO", status: "active" }],
    roleNames: ["Cashier"],
    permissions: ["pos.access", "attendance.use"],
    storeIds: [STORE_ID],
    features: { time_clock: true },
    ...overrides,
  };
}

const CLOCK_IN_BODY = { storeId: STORE_ID, employeeId: EMPLOYEE_ID, pin: "123456", requestId: REQUEST_ID };
const CLOCK_OUT_BODY = { employeeId: EMPLOYEE_ID, pin: "123456", requestId: REQUEST_ID };
const ROW = {
  result_code: "CLOCKED_IN",
  message: "Employee clocked in.",
  entry_id: ENTRY_ID,
  employee_id: EMPLOYEE_ID,
  employee_name: "Cashier",
  store_id: STORE_ID,
  store_name: "Main Store",
  clocked_in_at: "2026-10-22T01:00:00.000Z",
  clocked_out_at: null,
  was_replayed: false,
  shift_id: null,
  register_id: null,
  register_name: null,
  shift_opened_at: null,
};

function request(action, { body, headers = {} } = {}) {
  const value = body ?? (action === "clock-in" ? CLOCK_IN_BODY : CLOCK_OUT_BODY);
  return new Request(`https://backend.test/api/pos/v2/attendance/${action}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "x-tindio-organization-id": ORGANIZATION_ID,
      ...headers,
    },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
}

function dependencies(overrides = {}) {
  return {
    verifyClaims: async () => ({ data: { claims: { sub: "subject" } }, error: null }),
    loadCore: async () => ({ data: core(), error: null }),
    clockIn: async () => ({ data: [ROW], error: null }),
    clockOut: async () => ({ data: [{ ...ROW, result_code: "CLOCKED_OUT", message: "Employee clocked out.", clocked_out_at: "2026-10-22T09:00:00.000Z" }], error: null }),
    ...overrides,
  };
}

async function assertBody(response, status, body) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), body);
}

test("owned attendance mutations require a bounded bearer before context or body access", async () => {
  let coreCalls = 0;
  await assertBody(
    await handleOwnedAttendanceMutation(
      request("clock-in", { headers: { authorization: "Bearer invalid" } }),
      "clock-in",
      dependencies({ loadCore: async () => { coreCalls += 1; return { data: core(), error: null }; } }),
    ),
    401,
    { ok: false, reason: "AUTH_REQUIRED" },
  );
  assert.equal(coreCalls, 0);
});

test("owned attendance mutations preserve Auth, organization selection, and identity retry", async () => {
  let calls = 0;
  const response = await handleOwnedAttendanceMutation(
    request("clock-in", { headers: { "x-tindio-organization-id": "" } }),
    "clock-in",
    dependencies({
      loadCore: async (_token, organizationId) => {
        calls += 1;
        assert.equal(organizationId, null);
        return calls === 1
          ? { data: { ok: false, reason: "IDENTITY_UNMAPPED" }, error: null }
          : { data: core(), error: null };
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  await assertBody(
    await handleOwnedAttendanceMutation(
      request("clock-out", { headers: { "x-tindio-organization-id": "bad" } }),
      "clock-out",
      dependencies(),
    ),
    403,
    { ok: false, reason: "ORGANIZATION_FORBIDDEN" },
  );
});

test("owned attendance mutations validate complete business context", async () => {
  for (const [payload, status, body] of [
    [null, 503, { ok: false, reason: "INVALID_CORE_RESPONSE" }],
    [{ ok: false, reason: "NO_ACTIVE_EMPLOYEE" }, 403, { ok: false, reason: "NO_ACTIVE_EMPLOYEE" }],
    [core({ profileId: "bad" }), 503, { ok: false, reason: "INVALID_BUSINESS_CONTEXT" }],
    [core({ organization: { ...core().organization, status: "suspended" } }), 403, { ok: false, reason: "ORGANIZATION_INACTIVE" }],
  ]) {
    await assertBody(
      await handleOwnedAttendanceMutation(request("clock-in"), "clock-in", dependencies({
        loadCore: async () => ({ data: payload, error: null }),
      })),
      status,
      body,
    );
  }
});

test("owned attendance mutations preserve route gate precedence before JSON", async () => {
  let mutationCalls = 0;
  for (const context of [
    core({ features: { time_clock: false }, permissions: [] }),
    core({ permissions: [] }),
  ]) {
    await assertBody(
      await handleOwnedAttendanceMutation(request("clock-in", { body: "{" }), "clock-in", dependencies({
        loadCore: async () => ({ data: context, error: null }),
        clockIn: async () => { mutationCalls += 1; return { data: [ROW], error: null }; },
      })),
      200,
      { ok: false, message: "Time clock is disabled for this business." },
    );
  }
  assert.equal(mutationCalls, 0);
});

test("owned attendance mutations distinguish malformed JSON and action validation", async () => {
  await assertBody(
    await handleOwnedAttendanceMutation(request("clock-out", { body: "{" }), "clock-out", dependencies()),
    400,
    { ok: false, message: "The request data is invalid." },
  );
  await assertBody(
    await handleOwnedAttendanceMutation(
      request("clock-in", { body: { ...CLOCK_IN_BODY, storeId: OTHER_STORE_ID } }),
      "clock-in",
      dependencies(),
    ),
    200,
    { ok: false, message: "Choose one of your assigned stores before clocking in." },
  );
  await assertBody(
    await handleOwnedAttendanceMutation(
      request("clock-out", { body: { ...CLOCK_OUT_BODY, pin: "bad" } }),
      "clock-out",
      dependencies(),
    ),
    200,
    { ok: false, message: "Choose an employee and enter their 6–12 digit PIN." },
  );
});

test("owned clock-in sends exact tenant input and maps successful replay", async () => {
  let observed;
  await assertBody(
    await handleOwnedAttendanceMutation(request("clock-in", { body: { ...CLOCK_IN_BODY, ignored: true } }), "clock-in", dependencies({
      clockIn: async (token, organizationId, input) => {
        observed = { token, organizationId, input };
        return { data: [{ ...ROW, message: "This employee is already clocked in.", was_replayed: true }], error: null };
      },
    })),
    200,
    {
      ok: true,
      message: "This employee is already clocked in.",
      entry: {
        id: ENTRY_ID,
        employeeId: EMPLOYEE_ID,
        employeeName: "Cashier",
        storeId: STORE_ID,
        storeName: "Main Store",
        clockedInAt: "2026-10-22T01:00:00.000Z",
        clockedOutAt: null,
      },
    },
  );
  assert.deepEqual(observed, { token: TOKEN, organizationId: ORGANIZATION_ID, input: CLOCK_IN_BODY });
});

test("owned clock-out preserves the open-register-shift guard and completed result", async () => {
  await assertBody(
    await handleOwnedAttendanceMutation(request("clock-out"), "clock-out", dependencies({
      clockOut: async () => ({ data: [{
        ...ROW,
        result_code: "OPEN_REGISTER_SHIFT",
        message: "Close the register shift before clocking out.",
        shift_id: SHIFT_ID,
        register_id: REGISTER_ID,
        register_name: "Register 1",
        shift_opened_at: "2026-10-22T00:30:00.000Z",
      }], error: null }),
    })),
    200,
    {
      ok: false,
      code: "OPEN_REGISTER_SHIFT",
      message: "Close the register shift before clocking out.",
      openShift: {
        id: SHIFT_ID,
        registerId: REGISTER_ID,
        registerName: "Register 1",
        openedAt: "2026-10-22T00:30:00.000Z",
      },
    },
  );
});

test("owned attendance mutations preserve business errors and reject invalid provider data", async () => {
  await assertBody(
    await handleOwnedAttendanceMutation(request("clock-in"), "clock-in", dependencies({
      clockIn: async () => ({ data: null, error: { code: "23505", message: "This request already belongs elsewhere." } }),
    })),
    200,
    { ok: false, message: "This request already belongs elsewhere." },
  );
  await assertBody(
    await handleOwnedAttendanceMutation(request("clock-out"), "clock-out", dependencies({
      clockOut: async () => ({ data: [{ result_code: "CLOCKED_OUT" }], error: null }),
    })),
    200,
    { ok: false, message: "TINDIO could not clock this employee out." },
  );
});
