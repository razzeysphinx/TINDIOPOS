import assert from "node:assert/strict";
import test from "node:test";

import { handleOwnedPosAttendanceEmployees } from "../dist/src/pos/attendance-employees-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222222";
const EMPLOYEE_ID = "33333333-3333-4333-8333-333333333333";
const PROFILE_ID = "44444444-4444-4444-8444-444444444444";
const ENTRY_ID = "55555555-5555-4555-8555-555555555555";

function core(overrides = {}) {
  return {
    ok: true,
    profileId: PROFILE_ID,
    organization: {
      id: ORGANIZATION_ID,
      name: "Razzey Trading Corp.",
      currencyCode: "PHP",
      timezone: "Asia/Manila",
      status: "active",
      businessType: "retail",
      deviceManagementEnabled: true,
    },
    employee: {
      id: EMPLOYEE_ID,
      employeeNumber: "EMP-001",
      jobTitle: "Cashier",
      name: "Razzey Sphinx",
    },
    availableOrganizations: [{
      id: ORGANIZATION_ID,
      name: "Razzey Trading Corp.",
      status: "active",
    }],
    roleNames: ["Cashier"],
    permissions: ["pos.access", "attendance.use"],
    storeIds: [STORE_ID],
    features: { time_clock: true },
    ...overrides,
  };
}

function employeeRow(overrides = {}) {
  return {
    employee_id: EMPLOYEE_ID,
    employee_number: "EMP-001",
    employee_name: "Razzey Sphinx",
    pin_is_set: true,
    entry_id: ENTRY_ID,
    entry_store_id: STORE_ID,
    entry_store_name: "Main Store",
    clocked_in_at: "2026-10-20T08:00:00.000Z",
    ...overrides,
  };
}

function mappedEmployee(overrides = {}) {
  return {
    id: EMPLOYEE_ID,
    employeeNumber: "EMP-001",
    name: "Razzey Sphinx",
    pinIsSet: true,
    entry: {
      id: ENTRY_ID,
      employeeId: EMPLOYEE_ID,
      employeeName: "Razzey Sphinx",
      storeId: STORE_ID,
      storeName: "Main Store",
      clockedInAt: "2026-10-20T08:00:00.000Z",
    },
    ...overrides,
  };
}

function request(search = `?store=${STORE_ID}`, headers = {}) {
  return new Request(`https://backend.tindio.test/api/pos/v2/attendance/employees${search}`, {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "x-tindio-organization-id": ORGANIZATION_ID,
      ...headers,
    },
  });
}

function dependencies(overrides = {}) {
  return {
    createRequestId: () => "attendance-employees-request-id",
    verifyClaims: async () => ({ data: { claims: { sub: "subject" } }, error: null }),
    loadCore: async () => ({ data: core(), error: null }),
    loadAttendanceEmployees: async () => ({ data: [employeeRow()], error: null }),
    ...overrides,
  };
}

async function assertBody(response, status, body) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-tindio-request-id"), "attendance-employees-request-id");
  assert.deepEqual(await response.json(), body);
}

test("owned attendance employees require a bounded bearer", async () => {
  for (const authorization of ["", "Basic token", "Bearer invalid"]) {
    await assertBody(
      await handleOwnedPosAttendanceEmployees(
        request(undefined, { authorization }),
        dependencies(),
      ),
      401,
      { ok: false, reason: "AUTH_REQUIRED" },
    );
  }
});

test("owned attendance employees preserve Auth classifications and subject validation", async () => {
  for (const [verifyClaims, status, reason] of [
    [async () => { throw new SyntaxError("bad token"); }, 401, "AUTH_INVALID"],
    [async () => { throw Object.assign(new Error("busy"), { status: 429 }); }, 503, "AUTH_PROVIDER_UNAVAILABLE"],
    [async () => ({ data: null, error: null }), 503, "AUTH_INVALID"],
    [async () => ({ data: null, error: Object.assign(new Error("down"), { status: 503 }) }), 503, "AUTH_INVALID_OR_UNAVAILABLE"],
    [async () => ({ data: { claims: {} }, error: null }), 401, "AUTH_INVALID"],
  ]) {
    await assertBody(
      await handleOwnedPosAttendanceEmployees(request(), dependencies({ verifyClaims })),
      status,
      { ok: false, reason },
    );
  }
});

test("owned attendance employees preserve organization selection and retry identity mapping", async () => {
  let calls = 0;
  let observedOrganization = "not-called";
  const response = await handleOwnedPosAttendanceEmployees(
    request(undefined, { "x-tindio-organization-id": "" }),
    dependencies({
      loadCore: async (_token, organizationId) => {
        calls += 1;
        observedOrganization = organizationId;
        return calls === 1
          ? { data: { ok: false, reason: "IDENTITY_UNMAPPED" }, error: null }
          : { data: core(), error: null };
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.equal(observedOrganization, null);

  await assertBody(
    await handleOwnedPosAttendanceEmployees(
      request(undefined, { "x-tindio-organization-id": "invalid" }),
      dependencies(),
    ),
    403,
    { ok: false, reason: "ORGANIZATION_FORBIDDEN" },
  );
});

test("owned attendance employees validate business context", async () => {
  for (const [payload, status, body] of [
    [null, 503, { ok: false, reason: "INVALID_CORE_RESPONSE" }],
    [{ ok: false, reason: "NO_ACTIVE_EMPLOYEE" }, 403, { ok: false, reason: "NO_ACTIVE_EMPLOYEE" }],
    [core({ profileId: "invalid" }), 503, { ok: false, reason: "INVALID_BUSINESS_CONTEXT" }],
    [core({ organization: { ...core().organization, status: "suspended" } }), 403, { ok: false, reason: "ORGANIZATION_INACTIVE" }],
    [core({ organization: { ...core().organization, businessType: "unknown" } }), 503, { ok: false, reason: "INVALID_BUSINESS_TYPE" }],
  ]) {
    await assertBody(
      await handleOwnedPosAttendanceEmployees(request(), dependencies({
        loadCore: async () => ({ data: payload, error: null }),
      })),
      status,
      body,
    );
  }
});

test("owned attendance employees preserve the feature and permission gate", async () => {
  for (const payload of [
    core({ features: { time_clock: false } }),
    core({ permissions: ["pos.access"] }),
  ]) {
    await assertBody(
      await handleOwnedPosAttendanceEmployees(request(), dependencies({
        loadCore: async () => ({ data: payload, error: null }),
      })),
      403,
      {
        ok: false,
        message: "Attendance is unavailable for this store.",
        employees: [],
      },
    );
  }
});

test("owned attendance employees require an assigned store UUID", async () => {
  for (const search of ["", "?store=invalid", "?store=66666666-6666-4666-8666-666666666666"]) {
    await assertBody(
      await handleOwnedPosAttendanceEmployees(request(search), dependencies()),
      400,
      {
        ok: false,
        message: "Choose one of your assigned stores.",
        employees: [],
      },
    );
  }
});

test("owned attendance employees preserve first-value store parsing and RPC scope", async () => {
  let observed;
  const response = await handleOwnedPosAttendanceEmployees(
    request(`?store=${STORE_ID}&store=invalid`),
    dependencies({
      loadAttendanceEmployees: async (token, organizationId, storeId) => {
        observed = { token, organizationId, storeId };
        return { data: [employeeRow()], error: null };
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(observed, {
    token: TOKEN,
    organizationId: ORGANIZATION_ID,
    storeId: STORE_ID,
  });
});

test("owned attendance employees preserve the generic HTTP 200 loader failure", async () => {
  for (const loadAttendanceEmployees of [
    async () => { throw new Error("provider detail"); },
    async () => ({ data: null, error: { code: "42501", message: "private" } }),
    async () => ({ data: {}, error: null }),
    async () => ({ data: [employeeRow({ employee_id: "invalid" })], error: null }),
  ]) {
    await assertBody(
      await handleOwnedPosAttendanceEmployees(
        request(),
        dependencies({ loadAttendanceEmployees }),
      ),
      200,
      {
        ok: false,
        message: "TINDIO could not load employees for attendance.",
        employees: [],
      },
    );
  }
});

test("owned attendance employees treat null data as the established empty success", async () => {
  await assertBody(
    await handleOwnedPosAttendanceEmployees(request(), dependencies({
      loadAttendanceEmployees: async () => ({ data: null, error: null }),
    })),
    200,
    { ok: true, employees: [] },
  );
});

test("owned attendance employees map exact entry and fallback semantics", async () => {
  const response = await handleOwnedPosAttendanceEmployees(request(), dependencies({
    loadAttendanceEmployees: async () => ({
      data: [
        employeeRow(),
        employeeRow({
          employee_id: "66666666-6666-4666-8666-666666666666",
          employee_number: "EMP-002",
          employee_name: "Second Employee",
          pin_is_set: false,
          entry_id: "77777777-7777-4777-8777-777777777777",
          entry_store_name: null,
        }),
        employeeRow({
          employee_id: "88888888-8888-4888-8888-888888888888",
          employee_number: "EMP-003",
          employee_name: "Third Employee",
          entry_id: null,
          entry_store_id: null,
          entry_store_name: null,
          clocked_in_at: null,
        }),
      ],
      error: null,
    }),
  }));

  await assertBody(response, 200, {
    ok: true,
    employees: [
      mappedEmployee(),
      mappedEmployee({
        id: "66666666-6666-4666-8666-666666666666",
        employeeNumber: "EMP-002",
        name: "Second Employee",
        pinIsSet: false,
        entry: {
          ...mappedEmployee().entry,
          id: "77777777-7777-4777-8777-777777777777",
          employeeId: "66666666-6666-4666-8666-666666666666",
          employeeName: "Second Employee",
          storeName: "Assigned store",
        },
      }),
      mappedEmployee({
        id: "88888888-8888-4888-8888-888888888888",
        employeeNumber: "EMP-003",
        name: "Third Employee",
        entry: null,
      }),
    ],
  });
});
