import assert from "node:assert/strict";
import test from "node:test";

import {
  authErrorStatus,
  handleOwnedPosBootstrap,
} from "../dist/src/pos/bootstrap-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";

function request(headers = {}) {
  return new Request("https://backend.tindio.test/api/pos/v2/bootstrap", {
    headers,
  });
}

function dependencies(overrides = {}) {
  return {
    createRequestId: () => "owned-request-id",
    verifyClaims: async () => ({
      data: {
        claims: {
          sub: "user-id",
          email: "cashier@example.test",
        },
      },
      error: null,
    }),
    loadCore: async () => ({
      data: {
        ok: true,
        organization_id: ORGANIZATION_ID,
        permissions: ["pos.access", "sales.create"],
      },
      error: null,
    }),
    ...overrides,
  };
}

async function assertFailure(response, status, reason) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-tindio-request-id"), "owned-request-id");
  assert.deepEqual(await response.json(), {
    ok: false,
    reason,
    requestId: "owned-request-id",
  });
}

test("owned bootstrap requires a bounded three-part bearer token", async () => {
  for (const authorization of [
    undefined,
    "Basic credentials",
    "Bearer not-a-jwt",
    "Bearer header.payload.signature trailing",
    `Bearer ${"x".repeat(16_385)}.payload.signature`,
  ]) {
    let authCalled = false;
    const response = await handleOwnedPosBootstrap(
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

test("owned bootstrap maps invalid and unavailable Auth failures compatibly", async () => {
  for (const [error, status, reason] of [
    [new SyntaxError("bad JWT"), 401, "AUTH_INVALID"],
    [Object.assign(new Error("rejected"), { status: 403 }), 401, "AUTH_INVALID"],
    [Object.assign(new Error("rate limited"), { status: 429 }), 503, "AUTH_PROVIDER_UNAVAILABLE"],
    [new Error("network unavailable"), 503, "AUTH_PROVIDER_UNAVAILABLE"],
  ]) {
    const response = await handleOwnedPosBootstrap(
      request({ authorization: `Bearer ${TOKEN}` }),
      dependencies({
        verifyClaims: async () => {
          throw error;
        },
      }),
    );

    await assertFailure(response, status, reason);
  }
});

test("owned bootstrap preserves missing-claims and missing-subject statuses", async () => {
  const missingClaims = await handleOwnedPosBootstrap(
    request({ authorization: `Bearer ${TOKEN}` }),
    dependencies({
      verifyClaims: async () => ({ data: null, error: null }),
    }),
  );
  const missingSubject = await handleOwnedPosBootstrap(
    request({ authorization: `Bearer ${TOKEN}` }),
    dependencies({
      verifyClaims: async () => ({ data: { claims: {} }, error: null }),
    }),
  );

  await assertFailure(missingClaims, 503, "AUTH_INVALID");
  await assertFailure(missingSubject, 401, "AUTH_INVALID");
});

test("owned bootstrap retains the Web auth-result error mapping", async () => {
  const response = await handleOwnedPosBootstrap(
    request({ authorization: `Bearer ${TOKEN}` }),
    dependencies({
      verifyClaims: async () => ({
        data: null,
        error: Object.assign(new Error("service busy"), { status: 503 }),
      }),
    }),
  );

  await assertFailure(response, 503, "AUTH_INVALID_OR_UNAVAILABLE");
});

test("owned bootstrap validates organization scope before database access", async () => {
  let databaseCalled = false;
  const response = await handleOwnedPosBootstrap(
    request({
      authorization: `Bearer ${TOKEN}`,
      "x-tindio-organization-id": "not-a-uuid",
    }),
    dependencies({
      loadCore: async () => {
        databaseCalled = true;
        return { data: null, error: null };
      },
    }),
  );

  assert.equal(databaseCalled, false);
  await assertFailure(response, 403, "ORGANIZATION_FORBIDDEN");
});

test("owned bootstrap retries only an identity-unmapped core result", async () => {
  const calls = [];
  const response = await handleOwnedPosBootstrap(
    request({
      authorization: `Bearer ${TOKEN}`,
      "x-tindio-organization-id": ORGANIZATION_ID,
    }),
    dependencies({
      loadCore: async (token, organizationId) => {
        calls.push({ token, organizationId });

        return calls.length === 1
          ? { data: { ok: false, reason: "IDENTITY_UNMAPPED" }, error: null }
          : {
              data: {
                ok: true,
                permissions: ["pos.access", "sales.create"],
              },
              error: null,
            };
      },
    }),
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    token: TOKEN,
    organizationId: ORGANIZATION_ID,
  });
  assert.equal(response.status, 200);
});

test("owned bootstrap maps database failures and invalid payloads to bounded 503s", async () => {
  for (const [loadCore, reason] of [
    [async () => { throw new Error("secret provider detail"); }, "DATABASE_UNAVAILABLE"],
    [async () => ({ data: null, error: new Error("secret SQL detail") }), "DATABASE_UNAVAILABLE"],
    [async () => ({ data: [], error: null }), "INVALID_CORE_RESPONSE"],
  ]) {
    const response = await handleOwnedPosBootstrap(
      request({ authorization: `Bearer ${TOKEN}` }),
      dependencies({ loadCore }),
    );

    await assertFailure(response, 503, reason);
  }
});

test("owned bootstrap preserves core denial status and reason", async () => {
  for (const [core, status, reason] of [
    [{ ok: false, reason: "IDENTITY_UNMAPPED" }, 401, "IDENTITY_UNMAPPED"],
    [{ ok: false, reason: "ORGANIZATION_FORBIDDEN" }, 403, "ORGANIZATION_FORBIDDEN"],
    [{ ok: false }, 403, "POS_CONTEXT_UNAVAILABLE"],
  ]) {
    const response = await handleOwnedPosBootstrap(
      request({ authorization: `Bearer ${TOKEN}` }),
      dependencies({ loadCore: async () => ({ data: core, error: null }) }),
    );

    await assertFailure(response, status, reason);
  }
});

test("owned bootstrap requires both POS permissions", async () => {
  for (const permissions of [[], ["pos.access"], ["sales.create"], [null, 42]]) {
    const response = await handleOwnedPosBootstrap(
      request({ authorization: `Bearer ${TOKEN}` }),
      dependencies({
        loadCore: async () => ({
          data: { ok: true, permissions },
          error: null,
        }),
      }),
    );

    await assertFailure(response, 403, "POS_ACCESS_FORBIDDEN");
  }
});

test("owned bootstrap returns the exact client-safe success envelope", async () => {
  const core = {
    ok: true,
    organization_id: ORGANIZATION_ID,
    permissions: ["pos.access", "sales.create"],
  };
  const response = await handleOwnedPosBootstrap(
    request({ authorization: `Bearer ${TOKEN}` }),
    dependencies({
      loadCore: async () => ({ data: core, error: null }),
    }),
  );
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-tindio-request-id"), "owned-request-id");
  assert.deepEqual(JSON.parse(text), {
    ok: true,
    version: 2,
    requestId: "owned-request-id",
    core,
  });
  assert.doesNotMatch(text, /header\.payload\.signature|cashier@example\.test|user-id/);
});

test("auth error classification preserves 401 versus 503 behavior", () => {
  assert.equal(authErrorStatus(new Error("invalid JWT signature")), 401);
  assert.equal(authErrorStatus(Object.assign(new Error("bad"), { status: 404 })), 401);
  assert.equal(authErrorStatus(Object.assign(new Error("busy"), { status: 429 })), 503);
  assert.equal(authErrorStatus(new Error("network")), 503);
});
