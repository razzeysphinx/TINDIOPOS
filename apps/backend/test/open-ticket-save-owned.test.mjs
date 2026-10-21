import assert from "node:assert/strict";
import test from "node:test";

import { handleOwnedOpenTicketSave } from "../dist/src/pos/open-ticket-save-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_ID = "33333333-3333-4333-8333-333333333333";
const STORE_ID = "44444444-4444-4444-8444-444444444444";
const REGISTER_ID = "55555555-5555-4555-8555-555555555555";
const PRODUCT_ID = "66666666-6666-4666-8666-666666666666";
const TICKET_ID = "77777777-7777-4777-8777-777777777777";

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
    availableOrganizations: [{ id: ORGANIZATION_ID, name: "Razzey Trading Corp.", status: "active" }],
    roleNames: ["Cashier"],
    permissions: ["pos.access", "sales.create", "tickets.manage"],
    storeIds: [STORE_ID],
    features: { open_tickets: true },
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    storeId: STORE_ID,
    registerId: REGISTER_ID,
    ticketId: null,
    customerId: null,
    diningOptionId: null,
    assignedEmployeeId: null,
    label: "Table 7",
    note: "Allergy warning",
    cart: [{
      productId: PRODUCT_ID,
      variantId: null,
      quantity: 1,
      modifierOptionIds: [],
      productName: "Iced tea",
      variantName: null,
      sku: "TEA-1",
      barcode: null,
      categoryId: null,
      priceMinor: 12500,
      unit: "glass",
      isVariablePrice: false,
      allowFractionalQuantity: false,
      manualPriceMinor: null,
      ticketLineId: "88888888-8888-4888-8888-888888888888",
      itemNote: "Less ice",
    }],
    device: {
      deviceId: "99999999-9999-4999-8999-999999999999",
      secret: "a".repeat(64),
      appVersion: "mobile-1.0.0",
    },
    ...overrides,
  };
}

function request(body = input(), headers = {}) {
  return new Request("https://backend.tindio.test/api/pos/v2/tickets/save", {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "x-tindio-organization-id": ORGANIZATION_ID,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function dependencies(overrides = {}) {
  return {
    verifyClaims: async () => ({ data: { claims: { sub: "subject" } }, error: null }),
    loadCore: async () => ({ data: core(), error: null }),
    saveTicket: async () => ({ data: [{ ticket_id: TICKET_ID }], error: null }),
    ...overrides,
  };
}

async function assertJson(response, status, body) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), body);
}

test("owned open-ticket save requires a bounded bearer before reading the body", async () => {
  for (const authorization of ["", "Basic token", "Bearer invalid"]) {
    let coreCalled = false;
    await assertJson(await handleOwnedOpenTicketSave(
      request("not-json", { authorization }),
      dependencies({ loadCore: async () => { coreCalled = true; } }),
    ), 401, { ok: false, reason: "AUTH_REQUIRED" });
    assert.equal(coreCalled, false);
  }
});

test("owned open-ticket save preserves Auth classifications", async () => {
  for (const [verifyClaims, status, reason] of [
    [async () => { throw new SyntaxError("bad token"); }, 401, "AUTH_INVALID"],
    [async () => { throw Object.assign(new Error("busy"), { status: 429 }); }, 503, "AUTH_PROVIDER_UNAVAILABLE"],
    [async () => ({ data: null, error: null }), 503, "AUTH_INVALID"],
    [async () => ({ data: null, error: Object.assign(new Error("down"), { status: 503 }) }), 503, "AUTH_INVALID_OR_UNAVAILABLE"],
  ]) {
    await assertJson(
      await handleOwnedOpenTicketSave(request(), dependencies({ verifyClaims })),
      status,
      { ok: false, reason },
    );
  }
  await assertJson(await handleOwnedOpenTicketSave(request(), dependencies({
    verifyClaims: async () => ({ data: { claims: {} }, error: null }),
  })), 401, { ok: false, reason: "AUTH_INVALID" });
});

test("owned open-ticket save preserves organization selection and identity retry", async () => {
  const observed = [];
  let calls = 0;
  const response = await handleOwnedOpenTicketSave(
    request(undefined, { "x-tindio-organization-id": "" }),
    dependencies({
      loadCore: async (_token, organizationId) => {
        observed.push(organizationId);
        calls += 1;
        return calls === 1
          ? { data: { ok: false, reason: "IDENTITY_UNMAPPED" }, error: null }
          : { data: core(), error: null };
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(observed, [null, null]);
  await assertJson(await handleOwnedOpenTicketSave(
    request(undefined, { "x-tindio-organization-id": "invalid" }),
    dependencies(),
  ), 403, { ok: false, reason: "ORGANIZATION_FORBIDDEN" });
});

test("owned open-ticket save validates the complete business context", async () => {
  for (const [payload, status, body] of [
    [null, 503, { ok: false, reason: "INVALID_CORE_RESPONSE" }],
    [{ ok: false, reason: "NO_ACTIVE_EMPLOYEE" }, 403, { ok: false, reason: "NO_ACTIVE_EMPLOYEE" }],
    [core({ profileId: "invalid" }), 503, { ok: false, reason: "INVALID_BUSINESS_CONTEXT" }],
    [core({ organization: { ...core().organization, status: "suspended" } }), 403, { ok: false, reason: "ORGANIZATION_INACTIVE" }],
    [core({ organization: { ...core().organization, businessType: "unknown" } }), 503, { ok: false, reason: "INVALID_BUSINESS_TYPE" }],
  ]) {
    await assertJson(await handleOwnedOpenTicketSave(request(), dependencies({
      loadCore: async () => ({ data: payload, error: null }),
    })), status, body);
  }
});

test("owned open-ticket save preserves malformed JSON before action capability validation", async () => {
  await assertJson(await handleOwnedOpenTicketSave(request("not-json"), dependencies({
    loadCore: async () => ({ data: core({ permissions: [] }), error: null }),
  })), 400, { ok: false, message: "The request data is invalid." });
});

test("owned open-ticket save enforces permissions, feature, assigned store, and input bounds", async () => {
  for (const [payload, value] of [
    [core({ permissions: ["pos.access", "sales.create"] }), input()],
    [core({ features: { open_tickets: false } }), input()],
    [core({ storeIds: [] }), input()],
    [core(), input({ label: "" })],
  ]) {
    let saveCalled = false;
    await assertJson(await handleOwnedOpenTicketSave(request(value), dependencies({
      loadCore: async () => ({ data: payload, error: null }),
      saveTicket: async () => { saveCalled = true; },
    })), 200, { ok: false, message: "Check the ticket details and your store access." });
    assert.equal(saveCalled, false);
  }
});

test("owned open-ticket save normalizes then sends exact tenant input", async () => {
  let observed;
  const response = await handleOwnedOpenTicketSave(
    request({ ...input(), label: "  Table 7  ", note: "  Allergy warning  ", ignored: "strip" }),
    dependencies({
      saveTicket: async (token, organizationId, value) => {
        observed = { token, organizationId, value };
        return { data: [{ ticket_id: TICKET_ID }], error: null };
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(observed.token, TOKEN);
  assert.equal(observed.organizationId, ORGANIZATION_ID);
  assert.equal(observed.value.label, "Table 7");
  assert.equal(observed.value.note, "Allergy warning");
  assert.equal("ignored" in observed.value, false);
});

test("owned open-ticket save preserves RPC and provider failure mapping", async () => {
  for (const [saveTicket, message] of [
    [async () => ({ data: null, error: { code: "42501", message: "Sales permission is required." } }), "You do not have permission to change these tickets."],
    [async () => ({ data: null, error: { code: "42501", message: "This device is unavailable." } }), "This device is unavailable."],
    [async () => ({ data: null, error: { code: "23514", message: "The selected dining option is not active." } }), "The selected dining option is not active."],
    [async () => ({ data: null, error: { code: "P0002", message: "Gone" } }), "TINDIO could not save the ticket change. Nothing was moved."],
    [async () => { throw new Error("provider detail"); }, "TINDIO could not save the ticket change. Nothing was moved."],
    [async () => ({ data: [{ ticket_id: "invalid" }], error: null }), "TINDIO could not save the ticket change. Nothing was moved."],
  ]) {
    await assertJson(await handleOwnedOpenTicketSave(request(), dependencies({ saveTicket })), 200, {
      ok: false,
      message,
    });
  }
});

test("owned open-ticket save maps the exact success envelope", async () => {
  await assertJson(await handleOwnedOpenTicketSave(request(), dependencies()), 200, {
    ok: true,
    ticketId: TICKET_ID,
    message: "Ticket saved.",
  });
});
