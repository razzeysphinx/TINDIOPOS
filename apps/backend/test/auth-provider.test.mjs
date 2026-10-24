import assert from "node:assert/strict";
import test from "node:test";

import {
  createBackendAuthTokenVerifier,
  resolveBackendAuthProvider,
} from "../dist/src/auth/provider.js";
import { serveNeonBackendAuthProof } from "../dist/src/auth/neon-proof-service.js";

const neonProofEnvironment = {
  TINDIO_AUTH_PROVIDER: "neon",
  TINDIO_AUTH_PROOF_MODE: "local",
  NODE_ENV: "test",
  NEON_AUTH_BASE_URL:
    "https://ep-synthetic.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth",
  NEON_AUTH_JWKS_URL:
    "https://ep-synthetic.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json",
};

test("backend auth remains Supabase by default and gates Neon to local proof", () => {
  assert.equal(resolveBackendAuthProvider(undefined), "supabase");
  assert.throws(() => resolveBackendAuthProvider("neon"));
  assert.equal(
    resolveBackendAuthProvider("neon", neonProofEnvironment),
    "neon",
  );

  for (const rejectedEnvironment of [
    { ...neonProofEnvironment, TINDIO_AUTH_PROOF_MODE: "off" },
    { ...neonProofEnvironment, NODE_ENV: "production" },
    { ...neonProofEnvironment, VERCEL_ENV: "preview" },
    {
      ...neonProofEnvironment,
      NEON_AUTH_JWKS_URL: "https://attacker.invalid/jwks.json",
    },
  ]) {
    assert.throws(() => resolveBackendAuthProvider(
      "neon",
      rejectedEnvironment,
    ));
  }
});

test("Neon verifier normalizes an authenticated JWT and rejects missing role", async () => {
  const verifier = createBackendAuthTokenVerifier({
    environment: neonProofEnvironment,
    verifyNeonToken: async () => ({
      sub: "synthetic-user-id",
      email: "proof@auth-proof.tindio.invalid",
      role: "authenticated",
      exp: 2_000_000_000,
    }),
  });
  const valid = await verifier.verifyAccessToken("synthetic.jwt.token");

  assert.equal(valid.ok, true);
  assert.equal(valid.value.provider, "neon");
  assert.equal(valid.value.subject, "synthetic-user-id");
  assert.equal(valid.value.email, "proof@auth-proof.tindio.invalid");
  assert.equal(valid.value.role, "authenticated");

  const missingRole = createBackendAuthTokenVerifier({
    environment: neonProofEnvironment,
    verifyNeonToken: async () => ({ sub: "synthetic-user-id" }),
  });
  const invalid = await missingRole.verifyAccessToken("synthetic.jwt.token");
  assert.deepEqual(invalid, {
    ok: false,
    error: {
      code: "INVALID_TOKEN",
      message: "The Neon access token is invalid.",
      status: 401,
    },
  });
});

test("local proof route returns only normalized claims and denies invalid callers", async () => {
  const verifier = {
    provider: "neon",
    async verifyAccessToken(token) {
      if (token !== "valid-token") {
        return {
          ok: false,
          error: {
            code: "INVALID_TOKEN",
            message: "invalid",
            status: 401,
          },
        };
      }
      return {
        ok: true,
        value: {
          provider: "neon",
          subject: "synthetic-user-id",
          email: "proof@auth-proof.tindio.invalid",
          role: "authenticated",
          sessionId: null,
          expiresAt: "2033-05-18T03:33:20.000Z",
          raw: { secret: "must-not-leak" },
        },
      };
    },
  };
  const call = (authorization) => serveNeonBackendAuthProof(
    new Request("http://localhost/api/auth-proof/claims", {
      headers: authorization ? { authorization } : {},
    }),
    {
      environment: neonProofEnvironment,
      createVerifier: () => verifier,
    },
  );

  assert.equal((await call()).status, 401);
  assert.equal((await call("Bearer invalid-token")).status, 401);

  const response = await call("Bearer valid-token");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(body, {
    identity: {
      provider: "neon",
      subject: "synthetic-user-id",
      email: "proof@auth-proof.tindio.invalid",
      role: "authenticated",
      expiresAt: "2033-05-18T03:33:20.000Z",
    },
  });
  assert.doesNotMatch(JSON.stringify(body), /must-not-leak|valid-token/);
});
