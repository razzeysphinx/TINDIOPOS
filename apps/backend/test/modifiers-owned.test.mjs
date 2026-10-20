import assert from "node:assert/strict";
import test from "node:test";

import { handleOwnedPosModifiers } from "../dist/src/pos/modifiers-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";

const groups = () => [{
  id: "group",
  name: "Milk",
  minSelections: 0,
  maxSelections: 2,
  options: [{ id: "option", name: "Oat", priceMinor: 2500 }],
}];

function request(
  search = `?store=${STORE_ID}&product=${PRODUCT_ID}`,
  headers = {},
) {
  return new Request(`https://backend.tindio.test/api/pos/v2/modifiers${search}`, {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "x-tindio-organization-id": ORGANIZATION_ID,
      ...headers,
    },
  });
}

function dependencies(overrides = {}) {
  return {
    createRequestId: () => "modifiers-request-id",
    verifyClaims: async () => ({ data: { claims: {} }, error: null }),
    loadModifiers: async (_token, organizationId, query) => ({
      data: {
        ok: true,
        organizationId,
        storeId: query.store,
        productId: query.product,
        groups: groups(),
      },
      error: null,
    }),
    ...overrides,
  };
}

async function assertFailure(response, status, reason) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    ok: false,
    reason,
    requestId: "modifiers-request-id",
  });
}

test("owned modifiers reject invalid queries before authentication", async () => {
  for (const search of [
    "",
    `?store=${STORE_ID}`,
    `?product=${PRODUCT_ID}`,
    `?store=bad&product=${PRODUCT_ID}`,
    `?store=${STORE_ID}&product=bad`,
  ]) {
    let authCalled = false;
    const response = await handleOwnedPosModifiers(request(search), dependencies({
      verifyClaims: async () => {
        authCalled = true;
        return { data: null, error: null };
      },
    }));
    assert.equal(authCalled, false);
    await assertFailure(response, 400, "MODIFIER_QUERY_INVALID");
  }
});

test("owned modifiers pass exact store and product scope", async () => {
  let observed;
  const response = await handleOwnedPosModifiers(request(), dependencies({
    loadModifiers: async (token, organizationId, query) => {
      observed = { token, organizationId, query };
      return dependencies().loadModifiers(token, organizationId, query);
    },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(observed, {
    token: TOKEN,
    organizationId: ORGANIZATION_ID,
    query: { store: STORE_ID, product: PRODUCT_ID },
  });
});

test("owned modifiers require a bounded bearer and explicit organization", async () => {
  for (const authorization of ["", "Basic token", "Bearer invalid"]) {
    await assertFailure(
      await handleOwnedPosModifiers(request(undefined, { authorization }), dependencies()),
      401,
      "AUTH_REQUIRED",
    );
  }

  for (const organization of ["", "not-a-uuid"]) {
    await assertFailure(
      await handleOwnedPosModifiers(
        request(undefined, { "x-tindio-organization-id": organization }),
        dependencies(),
      ),
      403,
      "ORGANIZATION_FORBIDDEN",
    );
  }
});

test("owned modifiers preserve Auth result and exception classification", async () => {
  for (const [verifyClaims, status, reason] of [
    [async () => { throw new SyntaxError("bad token"); }, 401, "AUTH_INVALID"],
    [async () => { throw Object.assign(new Error("busy"), { status: 429 }); }, 503, "AUTH_PROVIDER_UNAVAILABLE"],
    [async () => ({ data: null, error: null }), 503, "AUTH_INVALID"],
    [async () => ({ data: null, error: Object.assign(new Error("down"), { status: 503 }) }), 503, "AUTH_INVALID_OR_UNAVAILABLE"],
  ]) {
    await assertFailure(
      await handleOwnedPosModifiers(request(), dependencies({ verifyClaims })),
      status,
      reason,
    );
  }
});

test("owned modifiers retry only identity mapping", async () => {
  let calls = 0;
  const response = await handleOwnedPosModifiers(request(), dependencies({
    loadModifiers: async (token, organizationId, query) => {
      calls += 1;
      return calls === 1
        ? { data: { ok: false, reason: "IDENTITY_UNMAPPED" }, error: null }
        : dependencies().loadModifiers(token, organizationId, query);
    },
  }));
  assert.equal(calls, 2);
  assert.equal(response.status, 200);
});

test("owned modifiers map database, denial, and invalid payload failures", async () => {
  for (const loadModifiers of [
    async () => { throw new Error("provider detail"); },
    async () => ({ data: null, error: new Error("SQL detail") }),
  ]) {
    await assertFailure(
      await handleOwnedPosModifiers(request(), dependencies({ loadModifiers })),
      503,
      "DATABASE_UNAVAILABLE",
    );
  }

  for (const [data, status, reason] of [
    [{ ok: false, reason: "CATALOG_PAGE_INVALID" }, 400, "CATALOG_PAGE_INVALID"],
    [{ ok: false, reason: "IDENTITY_UNMAPPED" }, 401, "IDENTITY_UNMAPPED"],
    [{ ok: false, reason: "POS_ACCESS_FORBIDDEN" }, 403, "POS_ACCESS_FORBIDDEN"],
    [{ ok: false }, 403, "POS_CONTEXT_UNAVAILABLE"],
    [{ ok: true, groups: [] }, 503, "INVALID_MODIFIERS_RESPONSE"],
    [{ ok: true, organizationId: ORGANIZATION_ID, storeId: STORE_ID, productId: PRODUCT_ID, groups: [{ ...groups()[0], maxSelections: "two" }] }, 503, "INVALID_MODIFIERS_RESPONSE"],
    [{ ok: true, organizationId: ORGANIZATION_ID, storeId: STORE_ID, productId: PRODUCT_ID, groups: [{ ...groups()[0], options: [{ id: "option", name: "Oat", priceMinor: "bad" }] }] }, 503, "INVALID_MODIFIERS_RESPONSE"],
  ]) {
    await assertFailure(
      await handleOwnedPosModifiers(request(), dependencies({
        loadModifiers: async () => ({ data, error: null }),
      })),
      status,
      reason,
    );
  }
});

test("owned modifiers return the exact versioned response", async () => {
  const response = await handleOwnedPosModifiers(request(), dependencies());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-tindio-request-id"), "modifiers-request-id");
  assert.deepEqual(body, {
    ok: true,
    version: 2,
    requestId: "modifiers-request-id",
    organizationId: ORGANIZATION_ID,
    storeId: STORE_ID,
    productId: PRODUCT_ID,
    groups: groups(),
  });
  assert.doesNotMatch(JSON.stringify(body), /header\.payload\.signature/);
});
