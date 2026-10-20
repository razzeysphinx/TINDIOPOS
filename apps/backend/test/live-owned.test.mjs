import assert from "node:assert/strict";
import test from "node:test";

import { handleOwnedPosLive } from "../dist/src/pos/live-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222222";
const REGISTER_ID = "33333333-3333-4333-8333-333333333333";

function livePayload(overrides = {}) {
  return {
    ok: true,
    organizationId: ORGANIZATION_ID,
    storeId: STORE_ID,
    registerId: REGISTER_ID,
    live: {
      timeClockEntry: null,
      customerDisplaySessions: [],
      canReceiveIncomingTransfers: true,
      incomingTransfersRaw: [],
      openTicketsRaw: [],
      ticketAssignees: [],
    },
    ...overrides,
  };
}

function request(headers = {}) {
  return new Request("https://backend.tindio.test/api/pos/v2/live", {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "x-tindio-organization-id": ORGANIZATION_ID,
      "x-tindio-store-id": STORE_ID,
      "x-tindio-register-id": REGISTER_ID,
      ...headers,
    },
  });
}

function dependencies(overrides = {}) {
  return {
    createRequestId: () => "live-request-id",
    verifyClaims: async () => ({ data: { claims: {} }, error: null }),
    loadLive: async () => ({ data: livePayload(), error: null }),
    ...overrides,
  };
}

async function assertBody(response, status, body) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-tindio-request-id"), "live-request-id");
  assert.deepEqual(await response.json(), body);
}

test("owned live requires a bounded bearer and always returns its request ID", async () => {
  for (const authorization of ["", "Basic token", "Bearer invalid"]) {
    await assertBody(
      await handleOwnedPosLive(request({ authorization }), dependencies()),
      401,
      { ok: false, reason: "AUTH_REQUIRED", requestId: "live-request-id" },
    );
  }
});

test("owned live validates organization, store, and register before Auth", async () => {
  for (const [headers, reason] of [
    [{ "x-tindio-organization-id": "" }, "ORGANIZATION_FORBIDDEN"],
    [{ "x-tindio-store-id": "invalid" }, "STORE_FORBIDDEN"],
    [{ "x-tindio-register-id": "invalid" }, "REGISTER_FORBIDDEN"],
    [{ "x-tindio-store-id": "" }, "STORE_REQUIRED_FOR_REGISTER"],
  ]) {
    let authCalled = false;
    const response = await handleOwnedPosLive(request(headers), dependencies({
      verifyClaims: async () => {
        authCalled = true;
        return { data: { claims: {} }, error: null };
      },
    }));
    assert.equal(authCalled, false);
    await assertBody(response, 403, {
      ok: false,
      reason,
      requestId: "live-request-id",
    });
  }
});

test("owned live preserves Auth error classifications without adding subject validation", async () => {
  for (const [verifyClaims, status, reason] of [
    [async () => { throw new SyntaxError("bad token"); }, 401, "AUTH_INVALID"],
    [async () => { throw Object.assign(new Error("busy"), { status: 429 }); }, 503, "AUTH_PROVIDER_UNAVAILABLE"],
    [async () => ({ data: null, error: null }), 503, "AUTH_INVALID"],
    [async () => ({ data: null, error: Object.assign(new Error("invalid"), { status: 401 }) }), 401, "AUTH_INVALID_OR_UNAVAILABLE"],
  ]) {
    await assertBody(
      await handleOwnedPosLive(request(), dependencies({ verifyClaims })),
      status,
      { ok: false, reason, requestId: "live-request-id" },
    );
  }

  assert.equal(
    (await handleOwnedPosLive(request(), dependencies({
      verifyClaims: async () => ({ data: { claims: {} }, error: null }),
    }))).status,
    200,
  );
});

test("owned live preserves optional scope and exact RPC arguments", async () => {
  let observed;
  const response = await handleOwnedPosLive(
    request({ "x-tindio-store-id": "", "x-tindio-register-id": "" }),
    dependencies({
      loadLive: async (token, organizationId, storeId, registerId) => {
        observed = { token, organizationId, storeId, registerId };
        return {
          data: livePayload({ storeId: null, registerId: null }),
          error: null,
        };
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(observed, {
    token: TOKEN,
    organizationId: ORGANIZATION_ID,
    storeId: undefined,
    registerId: undefined,
  });
});

test("owned live retries IDENTITY_UNMAPPED once", async () => {
  let calls = 0;
  const response = await handleOwnedPosLive(request(), dependencies({
    loadLive: async () => {
      calls += 1;
      return calls === 1
        ? { data: { ok: false, reason: "IDENTITY_UNMAPPED" }, error: null }
        : { data: livePayload(), error: null };
    },
  }));
  assert.equal(calls, 2);
  assert.equal(response.status, 200);
});

test("owned live preserves database and RPC-denial classifications", async () => {
  for (const [loadLive, status, reason] of [
    [async () => { throw new Error("provider detail"); }, 503, "DATABASE_UNAVAILABLE"],
    [async () => ({ data: null, error: { message: "private" } }), 503, "DATABASE_UNAVAILABLE"],
    [async () => ({ data: null, error: null }), 503, "INVALID_LIVE_RESPONSE"],
    [async () => ({ data: { ok: false }, error: null }), 403, "POS_CONTEXT_UNAVAILABLE"],
    [async () => ({ data: { ok: false, reason: "IDENTITY_UNMAPPED" }, error: null }), 401, "IDENTITY_UNMAPPED"],
    [async () => ({ data: { ok: false, reason: "STORE_FORBIDDEN" }, error: null }), 403, "STORE_FORBIDDEN"],
  ]) {
    await assertBody(
      await handleOwnedPosLive(request(), dependencies({ loadLive })),
      status,
      { ok: false, reason, requestId: "live-request-id" },
    );
  }
});

test("owned live rejects malformed aggregate envelopes", async () => {
  for (const data of [
    livePayload({ organizationId: 1 }),
    livePayload({ storeId: undefined }),
    livePayload({ live: { ...livePayload().live, timeClockEntry: {} } }),
    livePayload({ live: { ...livePayload().live, customerDisplaySessions: [{}] } }),
    livePayload({ live: { ...livePayload().live, incomingTransfersRaw: null } }),
  ]) {
    await assertBody(
      await handleOwnedPosLive(request(), dependencies({
        loadLive: async () => ({ data, error: null }),
      })),
      503,
      { ok: false, reason: "INVALID_LIVE_RESPONSE", requestId: "live-request-id" },
    );
  }
});

test("owned live maps valid aggregate rows and filters malformed nested rows", async () => {
  const response = await handleOwnedPosLive(request(), dependencies({
    loadLive: async () => ({
      data: livePayload({
        live: {
          timeClockEntry: {
            id: "clock",
            employeeId: "employee",
            employeeName: "Cashier",
            storeId: STORE_ID,
            storeName: "Main Store",
            clockedInAt: "2026-10-20T08:00:00.000Z",
          },
          customerDisplaySessions: [{
            sessionId: "session",
            registerId: REGISTER_ID,
            realtimeTopic: "topic",
          }],
          canReceiveIncomingTransfers: true,
          incomingTransfersRaw: [{ invalid: true }, {
            transfer_id: "transfer",
            transfer_number: "7",
            stock_request_id: null,
            source_store_id: "source",
            source_store_name: "Source",
            destination_store_id: STORE_ID,
            destination_store_name: "Main Store",
            status: "dispatched",
            note: 9,
            lines: [{ invalid: true }, {
              id: "line",
              label: "Coffee",
              unit: "each",
              quantity: "3",
              received_quantity: 1,
              short_quantity: "bad",
            }],
          }],
          openTicketsRaw: [{ invalid: true }, {
            ticket_id: "ticket",
            label: "Table 1",
            note: null,
            customer_id: "customer",
            customer_number: "12",
            loyalty_card_code: 9,
            customer_full_name: "Guest",
            customer_phone: null,
            customer_email: "guest@example.test",
            customer_loyalty_points: "4",
            dining_option_id: null,
            assigned_employee_id: "employee",
            updated_at: "2026-10-20T09:00:00.000Z",
            cart: [{ invalid: true }, {
              product_id: "product",
              quantity: "2",
              modifier_option_ids: ["option", 1],
              modifiers: [{ id: "modifier", name: "Extra", priceMinor: 50 }, {}],
            }],
          }],
          ticketAssignees: [{ id: "employee", fullName: "Cashier" }, {}],
        },
      }),
      error: null,
    }),
  }));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.version, 2);
  assert.equal(body.requestId, "live-request-id");
  assert.equal(body.live.incomingTransfers.length, 1);
  assert.equal(body.live.incomingTransfers[0].transferNumber, 7);
  assert.equal(body.live.incomingTransfers[0].note, null);
  assert.equal(body.live.incomingTransfers[0].lines[0].shortQuantity, 0);
  assert.equal(body.live.openTickets.length, 1);
  assert.equal(body.live.openTickets[0].cart[0].productName, "Saved item");
  assert.equal(body.live.openTickets[0].cart[0].unit, "each");
  assert.deepEqual(body.live.openTickets[0].cart[0].modifierOptionIds, ["option"]);
  assert.equal(body.live.openTickets[0].customer.loyaltyCardCode, "");
  assert.deepEqual(body.live.ticketAssignees, [{ id: "employee", fullName: "Cashier" }]);
});
