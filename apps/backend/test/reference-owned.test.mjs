import assert from "node:assert/strict";
import test from "node:test";

import { handleOwnedPosReference } from "../dist/src/pos/reference-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";

function reference() {
  return {
    categories: [{ id: "category", name: "Drinks", color: null }],
    paymentMethods: [{
      id: "payment",
      storeId: "store",
      name: "Cash",
      code: "CASH",
      type: "CASH",
      offlinePolicy: "cash",
      requiresReference: false,
      sortOrder: 1,
    }],
    loyaltyProgram: {
      isEnabled: true,
      earnSpendMinor: 100,
      earnPoints: 1,
      redemptionValueMinor: 10,
      minimumRedemptionPoints: 5,
    },
    discounts: [{
      id: "discount",
      name: "Senior",
      discountType: "percentage",
      percentageBps: 2_000,
      amountMinor: null,
    }],
    taxRates: [{
      id: "tax",
      name: "VAT",
      rateBps: 1_200,
      isInclusive: true,
      isDefault: true,
    }],
    diningOptions: [{ id: "dine-in", name: "Dine In", isDefault: true }],
    ticketTemplates: [{
      id: "template",
      label: "Table",
      note: null,
      diningOptionId: "dine-in",
    }],
  };
}

function request(headers = {}) {
  return new Request("https://backend.tindio.test/api/pos/v2/reference", {
    headers,
  });
}

function dependencies(overrides = {}) {
  return {
    createRequestId: () => "reference-request-id",
    verifyClaims: async () => ({ data: { claims: {} }, error: null }),
    loadReference: async () => ({
      data: {
        ok: true,
        organizationId: ORGANIZATION_ID,
        referenceVersion: "reference-v1",
        reference: reference(),
      },
      error: null,
    }),
    ...overrides,
  };
}

async function assertFailure(response, status, reason) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-tindio-request-id"), "reference-request-id");
  assert.deepEqual(await response.json(), {
    ok: false,
    reason,
    requestId: "reference-request-id",
  });
}

test("owned reference requires a bounded three-part bearer", async () => {
  for (const authorization of [undefined, "Basic token", "Bearer invalid"] ) {
    let authCalled = false;
    const response = await handleOwnedPosReference(
      request(authorization ? { authorization } : {}),
      dependencies({
        verifyClaims: async () => {
          authCalled = true;
          return { data: null, error: null };
        },
      }),
    );

    assert.equal(authCalled, false);
    await assertFailure(response, 401, "AUTH_REQUIRED");
  }
});

test("owned reference preserves Auth failure classification", async () => {
  for (const [error, status, reason] of [
    [new SyntaxError("bad token"), 401, "AUTH_INVALID"],
    [Object.assign(new Error("denied"), { status: 403 }), 401, "AUTH_INVALID"],
    [Object.assign(new Error("busy"), { status: 429 }), 503, "AUTH_PROVIDER_UNAVAILABLE"],
    [new Error("invalid JWT signature"), 503, "AUTH_PROVIDER_UNAVAILABLE"],
  ]) {
    const response = await handleOwnedPosReference(
      request({ authorization: `Bearer ${TOKEN}` }),
      dependencies({ verifyClaims: async () => { throw error; } }),
    );

    await assertFailure(response, status, reason);
  }
});

test("owned reference preserves missing-claims and result-error behavior", async () => {
  const missing = await handleOwnedPosReference(
    request({ authorization: `Bearer ${TOKEN}` }),
    dependencies({ verifyClaims: async () => ({ data: null, error: null }) }),
  );
  const errored = await handleOwnedPosReference(
    request({ authorization: `Bearer ${TOKEN}` }),
    dependencies({
      verifyClaims: async () => ({
        data: null,
        error: Object.assign(new Error("unavailable"), { status: 503 }),
      }),
    }),
  );

  await assertFailure(missing, 503, "AUTH_INVALID");
  await assertFailure(errored, 503, "AUTH_INVALID_OR_UNAVAILABLE");
});

test("owned reference validates explicit organization scope", async () => {
  let databaseCalled = false;
  const response = await handleOwnedPosReference(
    request({
      authorization: `Bearer ${TOKEN}`,
      "x-tindio-organization-id": "not-a-uuid",
    }),
    dependencies({
      loadReference: async () => {
        databaseCalled = true;
        return { data: null, error: null };
      },
    }),
  );

  assert.equal(databaseCalled, false);
  await assertFailure(response, 403, "ORGANIZATION_FORBIDDEN");
});

test("owned reference treats an empty organization header as absent", async () => {
  let observedOrganization = "not-called";
  const response = await handleOwnedPosReference(
    request({
      authorization: `Bearer ${TOKEN}`,
      "x-tindio-organization-id": "",
    }),
    dependencies({
      loadReference: async (_token, organizationId) => {
        observedOrganization = organizationId;
        return dependencies().loadReference();
      },
    }),
  );

  assert.equal(observedOrganization, null);
  assert.equal(response.status, 200);
});

test("owned reference retries only identity mapping", async () => {
  const calls = [];
  const response = await handleOwnedPosReference(
    request({
      authorization: `Bearer ${TOKEN}`,
      "x-tindio-organization-id": ORGANIZATION_ID,
    }),
    dependencies({
      loadReference: async (token, organizationId) => {
        calls.push({ token, organizationId });
        return calls.length === 1
          ? { data: { ok: false, reason: "IDENTITY_UNMAPPED" }, error: null }
          : dependencies().loadReference();
      },
    }),
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { token: TOKEN, organizationId: ORGANIZATION_ID });
  assert.equal(response.status, 200);
});

test("owned reference maps database and invalid-shape failures", async () => {
  for (const loadReference of [
    async () => { throw new Error("provider detail"); },
    async () => ({ data: null, error: new Error("SQL detail") }),
  ]) {
    const response = await handleOwnedPosReference(
      request({ authorization: `Bearer ${TOKEN}` }),
      dependencies({ loadReference }),
    );
    await assertFailure(response, 503, "DATABASE_UNAVAILABLE");
  }

  for (const payload of [
    null,
    [],
    { ok: true, organizationId: ORGANIZATION_ID, referenceVersion: "v1" },
    {
      ok: true,
      organizationId: ORGANIZATION_ID,
      referenceVersion: "v1",
      reference: { ...reference(), taxRates: [{ id: "tax" }] },
    },
  ]) {
    const response = await handleOwnedPosReference(
      request({ authorization: `Bearer ${TOKEN}` }),
      dependencies({
        loadReference: async () => ({ data: payload, error: null }),
      }),
    );
    await assertFailure(response, 503, "INVALID_REFERENCE_RESPONSE");
  }
});

test("owned reference preserves RPC denial statuses", async () => {
  for (const [payload, status, reason] of [
    [{ ok: false, reason: "IDENTITY_UNMAPPED" }, 401, "IDENTITY_UNMAPPED"],
    [{ ok: false, reason: "POS_ACCESS_FORBIDDEN" }, 403, "POS_ACCESS_FORBIDDEN"],
    [{ ok: false }, 403, "POS_CONTEXT_UNAVAILABLE"],
  ]) {
    const response = await handleOwnedPosReference(
      request({ authorization: `Bearer ${TOKEN}` }),
      dependencies({
        loadReference: async () => ({ data: payload, error: null }),
      }),
    );
    await assertFailure(response, status, reason);
  }
});

test("owned reference returns the exact response and cache-version headers", async () => {
  const response = await handleOwnedPosReference(
    request({ authorization: `Bearer ${TOKEN}` }),
    dependencies(),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-tindio-request-id"), "reference-request-id");
  assert.equal(response.headers.get("x-tindio-reference-version"), "reference-v1");
  assert.equal(response.headers.get("etag"), '"reference-v1"');
  assert.deepEqual(body, {
    ok: true,
    version: 2,
    requestId: "reference-request-id",
    organizationId: ORGANIZATION_ID,
    referenceVersion: "reference-v1",
    reference: reference(),
  });
  assert.doesNotMatch(JSON.stringify(body), /header\.payload\.signature/);
});
