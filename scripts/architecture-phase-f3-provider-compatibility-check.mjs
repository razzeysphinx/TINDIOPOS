import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  TINDIO_DEFAULT_AUTH_PROVIDER,
  resolveTindioAuthProvider,
} from "../packages/contracts/src/auth.ts";
import { resolveWebAuthProvider } from "../src/lib/auth/provider.ts";
import {
  createBackendAuthTokenVerifier,
  resolveBackendAuthProvider,
} from "../apps/backend/src/auth/provider.ts";
import {
  createNeonMobileAuth,
  neonMobileProofEnabled,
} from "../apps/mobile/src/features/session/neon-mobile-auth.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const managedBaseUrl =
  "https://phase-f.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth";
const backendProofEnvironment = {
  TINDIO_AUTH_PROVIDER: "neon",
  TINDIO_AUTH_PROOF_MODE: "local",
  NODE_ENV: "test",
  NEON_AUTH_BASE_URL: managedBaseUrl,
  NEON_AUTH_JWKS_URL: `${managedBaseUrl}/.well-known/jwks.json`,
};

test("F3 keeps Supabase as the default and Neon behind every proof guard", () => {
  assert.equal(TINDIO_DEFAULT_AUTH_PROVIDER, "supabase");
  assert.equal(resolveTindioAuthProvider(undefined), "supabase");
  assert.throws(() => resolveTindioAuthProvider("unexpected"));
  assert.equal(resolveWebAuthProvider(undefined), "supabase");
  assert.equal(resolveBackendAuthProvider(undefined), "supabase");
  assert.throws(() => resolveWebAuthProvider("neon"));
  assert.throws(() => resolveBackendAuthProvider("neon"));
  assert.equal(resolveBackendAuthProvider("neon", backendProofEnvironment), "neon");
  assert.equal(neonMobileProofEnabled({
    provider: "neon",
    proofMode: "local",
    baseUrl: managedBaseUrl,
    origin: "http://localhost:3108",
    productionBuild: false,
  }), true);
  assert.equal(neonMobileProofEnabled({
    provider: "neon",
    proofMode: "local",
    baseUrl: managedBaseUrl,
    origin: "http://localhost:3108",
    productionBuild: true,
  }), false);
});

test("F3 Backend normalizes Neon claims into the provider-neutral contract", async () => {
  const verifier = createBackendAuthTokenVerifier({
    environment: backendProofEnvironment,
    verifyNeonToken: async () => ({
      sub: "target-subject",
      email: "provider@example.invalid",
      role: "authenticated",
      session_id: "session-reference",
      exp: 2_000_000_000,
    }),
  });
  const result = await verifier.verifyAccessToken("synthetic.jwt.token");
  assert.deepEqual(result, {
    ok: true,
    value: {
      provider: "neon",
      subject: "target-subject",
      email: "provider@example.invalid",
      role: "authenticated",
      sessionId: "session-reference",
      expiresAt: "2033-05-18T03:33:20.000Z",
      raw: {
        sub: "target-subject",
        email: "provider@example.invalid",
        role: "authenticated",
        session_id: "session-reference",
        exp: 2_000_000_000,
      },
    },
  });
});

test("F3 Mobile returns the same session contract and bounded lifecycle events", async () => {
  const values = new Map();
  const storage = {
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
  };
  const token = "header.payload.signature";
  const fetch = async (input, init = {}) => {
    const path = new URL(input).pathname;
    const cookie = new Headers(init.headers).get("cookie");
    if (path.endsWith("/sign-in/email")) {
      return Response.json({}, {
        headers: { "set-cookie": "neon-auth.session_token=f3-cookie; HttpOnly; Secure; Path=/" },
      });
    }
    if (path.endsWith("/get-session")) {
      return cookie?.includes("f3-cookie")
        ? Response.json({
            session: { expiresAt: "2033-05-18T03:33:20.000Z" },
            user: {
              id: "target-subject",
              email: "provider@example.invalid",
              name: "Provider proof",
            },
          })
        : Response.json(null);
    }
    if (path.endsWith("/token")) return Response.json({ token });
    if (path.endsWith("/sign-out")) return Response.json({ success: true });
    return Response.json({}, { status: 404 });
  };
  const adapter = createNeonMobileAuth({
    baseUrl: managedBaseUrl,
    origin: "http://localhost:3108",
    storage,
    fetch,
  });
  const events = [];
  const unsubscribe = adapter.onAuthStateChange((event) => events.push(event));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const signedIn = await adapter.signInWithPassword({
    email: "provider@example.invalid",
    password: "synthetic-only",
  });
  assert.equal(signedIn.ok, true);
  assert.deepEqual(signedIn.ok ? signedIn.value : null, {
    provider: "neon",
    accessToken: token,
    expiresAt: "2033-05-18T03:33:20.000Z",
    identity: {
      subject: "target-subject",
      email: "provider@example.invalid",
      displayName: "Provider proof",
    },
  });
  assert.equal((await adapter.signOut()).ok, true);
  unsubscribe();
  assert.deepEqual(events, ["INITIAL_SESSION", "SIGNED_IN", "SIGNED_OUT"]);
});

test("F3 integration surfaces consume provider-neutral adapters", async () => {
  const [contracts, webServer, webBrowser, backend, mobileSession, mobileApi] =
    await Promise.all([
      read("packages/contracts/src/auth.ts"),
      read("src/lib/supabase/server.ts"),
      read("src/lib/supabase/client.ts"),
      read("apps/backend/src/pos/pos-read-runtime.ts"),
      read("apps/mobile/src/features/session/session-provider.tsx"),
      read("apps/mobile/src/lib/tindio-api.ts"),
    ]);
  assert.match(contracts, /type AuthSessionAdapter/);
  assert.match(webServer, /resolveWebAuthProvider/);
  assert.match(webBrowser, /resolveWebAuthProvider/);
  assert.match(backend, /authVerifier\.verifyAccessToken/);
  assert.match(mobileSession, /mobileAuth\.onAuthStateChange/);
  assert.match(mobileApi, /mobileAuth\.refreshSession/);
});

test("F3 evidence records compatibility without production enablement", async () => {
  const [evidenceSource, packageSource] = await Promise.all([
    read("docs/architecture/TINDIO_PHASE_F3_PROVIDER_COMPATIBILITY.json"),
    read("package.json"),
  ]);
  const evidence = JSON.parse(evidenceSource);
  const packageJson = JSON.parse(packageSource);
  assert.equal(evidence.status, "PASS");
  assert.equal(evidence.supabaseRemainsDefault, true);
  assert.equal(evidence.productionNeonAuthEnabled, false);
  assert.equal(
    packageJson.scripts["test:architecture-phase-f3-provider-compatibility"],
    "node --test scripts/architecture-phase-f3-provider-compatibility-check.mjs",
  );
});
