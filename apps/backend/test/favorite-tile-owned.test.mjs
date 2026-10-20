import assert from "node:assert/strict";
import test from "node:test";

import { handleOwnedFavoriteTileUpdate } from "../dist/src/pos/favorite-tile-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_ID = "33333333-3333-4333-8333-333333333333";
const STORE_ID = "44444444-4444-4444-8444-444444444444";
const PRODUCT_ID = "55555555-5555-4555-8555-555555555555";
const VARIANT_ID = "66666666-6666-4666-8666-666666666666";

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
    permissions: ["pos.access", "sales.create", "products.manage"],
    storeIds: [STORE_ID],
    features: {},
    ...overrides,
  };
}

function update(overrides = {}) {
  return {
    storeId: STORE_ID,
    productId: PRODUCT_ID,
    variantId: VARIANT_ID,
    isFavorite: true,
    ...overrides,
  };
}

function request(body = update(), headers = {}) {
  return new Request("https://backend.tindio.test/api/pos/v2/favorites", {
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
    updateFavorite: async (_token, _organizationId, value) => ({
      data: value.isFavorite,
      error: null,
    }),
    ...overrides,
  };
}

async function assertJson(response, status, body) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), body);
}

test("owned favorite tile requires a bounded bearer before reading the body", async () => {
  for (const authorization of ["", "Basic token", "Bearer invalid"]) {
    let coreCalled = false;
    await assertJson(
      await handleOwnedFavoriteTileUpdate(
        request("not-json", { authorization }),
        dependencies({ loadCore: async () => { coreCalled = true; } }),
      ),
      401,
      { ok: false, reason: "AUTH_REQUIRED" },
    );
    assert.equal(coreCalled, false);
  }
});

test("owned favorite tile preserves Auth classifications", async () => {
  for (const [verifyClaims, status, reason] of [
    [async () => { throw new SyntaxError("bad token"); }, 401, "AUTH_INVALID"],
    [async () => { throw Object.assign(new Error("busy"), { status: 429 }); }, 503, "AUTH_PROVIDER_UNAVAILABLE"],
    [async () => ({ data: null, error: null }), 503, "AUTH_INVALID"],
    [async () => ({ data: null, error: Object.assign(new Error("down"), { status: 503 }) }), 503, "AUTH_INVALID_OR_UNAVAILABLE"],
  ]) {
    await assertJson(
      await handleOwnedFavoriteTileUpdate(request(), dependencies({ verifyClaims })),
      status,
      { ok: false, reason },
    );
  }

  await assertJson(
    await handleOwnedFavoriteTileUpdate(request(), dependencies({
      verifyClaims: async () => ({ data: { claims: {} }, error: null }),
    })),
    401,
    { ok: false, reason: "AUTH_INVALID" },
  );
});

test("owned favorite tile preserves organization selection and identity retry", async () => {
  const observed = [];
  let calls = 0;
  const response = await handleOwnedFavoriteTileUpdate(
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

  await assertJson(
    await handleOwnedFavoriteTileUpdate(
      request(undefined, { "x-tindio-organization-id": "invalid" }),
      dependencies(),
    ),
    403,
    { ok: false, reason: "ORGANIZATION_FORBIDDEN" },
  );
});

test("owned favorite tile validates the full business context", async () => {
  for (const [payload, status, body] of [
    [null, 503, { ok: false, reason: "INVALID_CORE_RESPONSE" }],
    [{ ok: false, reason: "NO_ACTIVE_EMPLOYEE" }, 403, { ok: false, reason: "NO_ACTIVE_EMPLOYEE" }],
    [core({ profileId: "invalid" }), 503, { ok: false, reason: "INVALID_BUSINESS_CONTEXT" }],
    [core({ organization: { ...core().organization, status: "suspended" } }), 403, { ok: false, reason: "ORGANIZATION_INACTIVE" }],
    [core({ organization: { ...core().organization, businessType: "unknown" } }), 503, { ok: false, reason: "INVALID_BUSINESS_TYPE" }],
  ]) {
    await assertJson(
      await handleOwnedFavoriteTileUpdate(request(), dependencies({
        loadCore: async () => ({ data: payload, error: null }),
      })),
      status,
      body,
    );
  }
});

test("owned favorite tile checks permission before parsing the body", async () => {
  let updateCalled = false;
  await assertJson(
    await handleOwnedFavoriteTileUpdate(
      request("not-json"),
      dependencies({
        loadCore: async () => ({ data: core({ permissions: ["pos.access"] }), error: null }),
        updateFavorite: async () => { updateCalled = true; },
      }),
    ),
    200,
    { ok: false, message: "Product-management permission is required to configure POS tiles." },
  );
  assert.equal(updateCalled, false);
});

test("owned favorite tile distinguishes malformed JSON from action validation", async () => {
  let updateCalled = false;
  await assertJson(
    await handleOwnedFavoriteTileUpdate(request("not-json"), dependencies({
      updateFavorite: async () => { updateCalled = true; },
    })),
    400,
    { ok: false, message: "The request data is invalid." },
  );
  await assertJson(
    await handleOwnedFavoriteTileUpdate(request({}), dependencies({
      updateFavorite: async () => { updateCalled = true; },
    })),
    200,
    { ok: false, message: "Choose a product in one of your assigned stores." },
  );
  await assertJson(
    await handleOwnedFavoriteTileUpdate(request(update({ storeId: PROFILE_ID })), dependencies({
      updateFavorite: async () => { updateCalled = true; },
    })),
    200,
    { ok: false, message: "Choose a product in one of your assigned stores." },
  );
  assert.equal(updateCalled, false);
});

test("owned favorite tile validates then sends the exact nullable RPC input", async () => {
  let observed;
  const response = await handleOwnedFavoriteTileUpdate(
    request({ ...update({ variantId: null }), ignored: "strip" }),
    dependencies({
      updateFavorite: async (token, organizationId, value) => {
        observed = { token, organizationId, value };
        return { data: true, error: null };
      },
    }),
  );
  await assertJson(response, 200, {
    ok: true,
    isFavorite: true,
    message: "Product pinned to POS favorites.",
  });
  assert.deepEqual(observed, {
    token: TOKEN,
    organizationId: ORGANIZATION_ID,
    value: update({ variantId: null }),
  });
});

test("owned favorite tile preserves RPC failures and result mismatches as HTTP 200", async () => {
  for (const [updateFavorite, message] of [
    [async () => ({ data: null, error: { code: "42501" } }), "You do not have permission to configure tiles for this POS."],
    [async () => ({ data: null, error: { code: "22023" } }), "Only currently saleable products can be pinned, with up to 24 favorites."],
    [async () => ({ data: false, error: null }), "TINDIO could not update this POS tile."],
    [async () => { throw new Error("provider detail"); }, "TINDIO could not update this POS tile."],
  ]) {
    await assertJson(
      await handleOwnedFavoriteTileUpdate(request(), dependencies({ updateFavorite })),
      200,
      { ok: false, message },
    );
  }
});

test("owned favorite tile preserves exact idempotent pin and unpin successes", async () => {
  for (const isFavorite of [true, false]) {
    await assertJson(
      await handleOwnedFavoriteTileUpdate(request(update({ isFavorite })), dependencies()),
      200,
      {
        ok: true,
        isFavorite,
        message: isFavorite
          ? "Product pinned to POS favorites."
          : "Product removed from POS favorites.",
      },
    );
  }
});
