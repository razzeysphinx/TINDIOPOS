import assert from "node:assert/strict";
import test from "node:test";

import { handleOwnedPosCatalog } from "../dist/src/pos/catalog-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222222";
const CATEGORY_ID = "33333333-3333-4333-8333-333333333333";

const item = () => ({
  productId: "product",
  variantId: null,
  categoryId: CATEGORY_ID,
  productName: "Coffee",
  variantName: null,
  sku: null,
  barcode: null,
  priceMinor: 12500,
  unit: "piece",
  imageUrl: null,
  isVariablePrice: false,
  allowFractionalQuantity: false,
  hasModifiers: true,
});

function request(search = `?store=${STORE_ID}`, headers = {}) {
  return new Request(`https://backend.tindio.test/api/pos/v2/catalog${search}`, {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "x-tindio-organization-id": ORGANIZATION_ID,
      ...headers,
    },
  });
}

function dependencies(overrides = {}) {
  return {
    createRequestId: () => "catalog-request-id",
    verifyClaims: async () => ({ data: { claims: {} }, error: null }),
    loadCatalog: async (_token, organizationId, query) => ({
      data: {
        ok: true,
        organizationId,
        storeId: query.store,
        mode: query.mode,
        offset: query.offset,
        limit: query.limit,
        items: [item()],
        hasMore: false,
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
    requestId: "catalog-request-id",
  });
}

test("owned catalogue rejects invalid queries before authentication", async () => {
  for (const search of [
    "",
    "?store=bad",
    `?store=${STORE_ID}&mode=unknown`,
    `?store=${STORE_ID}&category=bad`,
    `?store=${STORE_ID}&offset=-1`,
    `?store=${STORE_ID}&offset=1.5`,
    `?store=${STORE_ID}&limit=0`,
    `?store=${STORE_ID}&limit=25`,
    `?store=${STORE_ID}&query=${"x".repeat(101)}`,
  ]) {
    let authCalled = false;
    const response = await handleOwnedPosCatalog(request(search), dependencies({
      verifyClaims: async () => {
        authCalled = true;
        return { data: null, error: null };
      },
    }));
    assert.equal(authCalled, false);
    await assertFailure(response, 400, "CATALOG_QUERY_INVALID");
  }
});

test("owned catalogue applies defaults, trimming, modes, and pagination", async () => {
  const observed = [];
  for (const search of [
    `?store=${STORE_ID}`,
    `?store=${STORE_ID}&mode=favorites&query=%20latte%20&category=${CATEGORY_ID}&offset=24&limit=12`,
    `?store=${STORE_ID}&mode=recent&offset=&limit=1`,
  ]) {
    const response = await handleOwnedPosCatalog(request(search), dependencies({
      loadCatalog: async (token, organizationId, query) => {
        observed.push({ token, organizationId, query });
        return dependencies().loadCatalog(token, organizationId, query);
      },
    }));
    assert.equal(response.status, 200);
  }

  assert.deepEqual(observed.map(({ query }) => query), [
    { store: STORE_ID, mode: "search", query: "", offset: 0, limit: 24 },
    { store: STORE_ID, mode: "favorites", query: "latte", category: CATEGORY_ID, offset: 24, limit: 12 },
    { store: STORE_ID, mode: "recent", query: "", offset: 0, limit: 1 },
  ]);
});

test("owned catalogue requires a bounded bearer and explicit organization", async () => {
  for (const headers of [
    { authorization: "" },
    { authorization: "Basic token" },
    { authorization: "Bearer invalid" },
  ]) {
    await assertFailure(
      await handleOwnedPosCatalog(request(`?store=${STORE_ID}`, headers), dependencies()),
      401,
      "AUTH_REQUIRED",
    );
  }

  for (const organization of ["", "not-a-uuid"]) {
    await assertFailure(
      await handleOwnedPosCatalog(
        request(`?store=${STORE_ID}`, { "x-tindio-organization-id": organization }),
        dependencies(),
      ),
      403,
      "ORGANIZATION_FORBIDDEN",
    );
  }
});

test("owned catalogue preserves Auth failure classification", async () => {
  for (const [error, status, reason] of [
    [new SyntaxError("bad token"), 401, "AUTH_INVALID"],
    [Object.assign(new Error("denied"), { status: 403 }), 401, "AUTH_INVALID"],
    [Object.assign(new Error("busy"), { status: 429 }), 503, "AUTH_PROVIDER_UNAVAILABLE"],
  ]) {
    const response = await handleOwnedPosCatalog(request(), dependencies({
      verifyClaims: async () => { throw error; },
    }));
    await assertFailure(response, status, reason);
  }
});

test("owned catalogue retries only identity mapping", async () => {
  let calls = 0;
  const response = await handleOwnedPosCatalog(request(), dependencies({
    loadCatalog: async (token, organizationId, query) => {
      calls += 1;
      return calls === 1
        ? { data: { ok: false, reason: "IDENTITY_UNMAPPED" }, error: null }
        : dependencies().loadCatalog(token, organizationId, query);
    },
  }));
  assert.equal(calls, 2);
  assert.equal(response.status, 200);
});

test("owned catalogue maps database, denial, and invalid payload failures", async () => {
  for (const loadCatalog of [
    async () => { throw new Error("provider detail"); },
    async () => ({ data: null, error: new Error("SQL detail") }),
  ]) {
    await assertFailure(
      await handleOwnedPosCatalog(request(), dependencies({ loadCatalog })),
      503,
      "DATABASE_UNAVAILABLE",
    );
  }

  for (const [data, status, reason] of [
    [{ ok: false, reason: "CATALOG_MODE_INVALID" }, 400, "CATALOG_MODE_INVALID"],
    [{ ok: false, reason: "CATALOG_PAGE_INVALID" }, 400, "CATALOG_PAGE_INVALID"],
    [{ ok: false, reason: "IDENTITY_UNMAPPED" }, 401, "IDENTITY_UNMAPPED"],
    [{ ok: false }, 403, "POS_CONTEXT_UNAVAILABLE"],
    [{ ok: true, items: [] }, 503, "INVALID_CATALOG_RESPONSE"],
    [{ ok: true, organizationId: ORGANIZATION_ID, storeId: STORE_ID, mode: "search", offset: 0, limit: 24, items: [{ ...item(), priceMinor: "bad" }], hasMore: false }, 503, "INVALID_CATALOG_RESPONSE"],
  ]) {
    await assertFailure(
      await handleOwnedPosCatalog(request(), dependencies({
        loadCatalog: async () => ({ data, error: null }),
      })),
      status,
      reason,
    );
  }
});

test("owned catalogue returns the exact versioned response", async () => {
  const response = await handleOwnedPosCatalog(request(), dependencies());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-tindio-request-id"), "catalog-request-id");
  assert.deepEqual(body, {
    ok: true,
    version: 2,
    requestId: "catalog-request-id",
    organizationId: ORGANIZATION_ID,
    storeId: STORE_ID,
    mode: "search",
    offset: 0,
    limit: 24,
    items: [item()],
    hasMore: false,
  });
  assert.doesNotMatch(JSON.stringify(body), /header\.payload\.signature/);
});
