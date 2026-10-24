import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createNeonMobileAuth,
  NEON_MOBILE_AUTH_COOKIE_KEY,
  neonMobileProofEnabled,
} from "../apps/mobile/src/features/session/neon-mobile-auth.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const managedUrl = "https://phase-e.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth";

test("original E5 keeps Neon Mobile Auth behind a local non-production guard", () => {
  assert.equal(neonMobileProofEnabled({
    provider: "neon",
    proofMode: "local",
    baseUrl: managedUrl,
    origin: "http://localhost:3108",
    productionBuild: false,
  }), true);
  for (const override of [
    { provider: "supabase" },
    { proofMode: "production" },
    { baseUrl: "https://example.com/auth" },
    { origin: "https://app.tindio.example" },
    { productionBuild: true },
  ]) {
    assert.equal(neonMobileProofEnabled({
      provider: "neon",
      proofMode: "local",
      baseUrl: managedUrl,
      origin: "http://localhost:3108",
      productionBuild: false,
      ...override,
    }), false);
  }
});

test("original E5 persists and restores only the Neon session cookie", async () => {
  const values = new Map([
    ["tindio.device.org-1", "device-identity"],
    ["tindio.offline.authorization.v1", "offline-grant"],
  ]);
  const storage = {
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
  };
  const calls = [];
  const jwt = `${btoa("header")}.${btoa("payload")}.${btoa("signature")}`;
  const fakeFetch = async (input, init = {}) => {
    const path = new URL(input).pathname;
    const cookie = new Headers(init.headers).get("cookie");
    calls.push(path);
    if (path.endsWith("/sign-in/email")) {
      return Response.json({ user: { id: "proof-user" } }, {
        headers: { "set-cookie": "neon-auth.session_token=proof-cookie; HttpOnly; Secure; Path=/" },
      });
    }
    if (path.endsWith("/get-session")) {
      return cookie?.includes("proof-cookie")
        ? Response.json({
            session: { expiresAt: "2099-01-01T00:00:00.000Z" },
            user: { id: "proof-user", email: "mobile@auth-proof.tindio.invalid", name: "Mobile proof" },
          })
        : Response.json(null);
    }
    if (path.endsWith("/token")) return Response.json({ token: jwt });
    if (path.endsWith("/sign-out")) {
      return Response.json({ success: true }, {
        headers: { "set-cookie": "neon-auth.session_token=; Max-Age=0; Path=/" },
      });
    }
    return Response.json({}, { status: 404 });
  };

  const first = createNeonMobileAuth({ baseUrl: managedUrl, origin: "http://localhost:3108", storage, fetch: fakeFetch });
  const signedIn = await first.signInWithPassword({
    email: "mobile@auth-proof.tindio.invalid",
    password: "synthetic-only",
  });
  assert.equal(signedIn.ok, true);
  assert.match(values.get(NEON_MOBILE_AUTH_COOKIE_KEY) ?? "", /proof-cookie/);

  const restored = createNeonMobileAuth({ baseUrl: managedUrl, origin: "http://localhost:3108", storage, fetch: fakeFetch });
  const restoredSession = await restored.getSession();
  assert.equal(restoredSession.ok && restoredSession.value?.identity.subject, "proof-user");

  const beforeRefresh = calls.length;
  const [refreshA, refreshB] = await Promise.all([
    restored.refreshSession(),
    restored.refreshSession(),
  ]);
  assert.equal(refreshA.ok, true);
  assert.equal(refreshB.ok, true);
  assert.deepEqual(calls.slice(beforeRefresh), [
    "/neondb/auth/get-session",
    "/neondb/auth/token",
  ]);

  const sqliteCustody = Object.freeze({
    outboxRows: 1,
    receiptSnapshots: 1,
    localTransactions: 1,
  });
  const custodyBefore = JSON.stringify(sqliteCustody);
  assert.equal((await restored.signOut()).ok, true);
  assert.equal(values.has(NEON_MOBILE_AUTH_COOKIE_KEY), false);
  assert.equal(values.get("tindio.device.org-1"), "device-identity");
  assert.equal(values.get("tindio.offline.authorization.v1"), "offline-grant");
  assert.equal(JSON.stringify(sqliteCustody), custodyBefore);
});

test("original E5 wiring keeps Supabase default and custody modules outside Auth", async () => {
  const [adapter, environment, neon, session, device, outbox] = await Promise.all([
    read("apps/mobile/src/features/session/auth-provider.ts"),
    read("apps/mobile/src/lib/env.ts"),
    read("apps/mobile/src/features/session/neon-mobile-auth.ts"),
    read("apps/mobile/src/features/session/session-provider.tsx"),
    read("apps/mobile/src/features/device/device-store.ts"),
    read("apps/mobile/src/db/outbox.ts"),
  ]);
  assert.match(adapter, /neonProofEnabled \? \["supabase", "neon"\] : \["supabase"\]/);
  assert.match(adapter, /storage: secureStorage/);
  assert.match(environment, /EXPO_PUBLIC_TINDIO_AUTH_PROOF_MODE/);
  assert.match(environment, /EXPO_PUBLIC_NEON_AUTH_BASE_URL/);
  assert.match(environment, /EXPO_PUBLIC_TINDIO_AUTH_PROOF_ORIGIN/);
  assert.doesNotMatch(neon, /\.\.\/\.\.\/db|device-store|receipt-cache|outbox/);
  assert.match(session, /canReleaseTransactionCustody/);
  assert.match(device, /secureStorage\.setItem/);
  assert.match(outbox, /outbox_events/);
});

test("original E5 evidence promotes only the three Mobile flows", async () => {
  const [matrixSource, evidenceSource, handoff, packageSource] = await Promise.all([
    read("docs/architecture/TINDIO_PHASE_E_AUTH_PROOF_MATRIX.json"),
    read("docs/architecture/TINDIO_PHASE_E_PLANNED_E5_MOBILE_AUTH_PROOF.json"),
    read("docs/architecture/TINDIO_PHASE_E_PLANNED_E5_MOBILE_AUTH.md"),
    read("package.json"),
  ]);
  const matrix = JSON.parse(matrixSource);
  const evidence = JSON.parse(evidenceSource);
  const packageJson = JSON.parse(packageSource);
  assert.equal(matrix.requiredFlowCount, 13);
  assert.ok(matrix.passedFlowCount >= 11);
  for (const id of ["E-AUTH-08", "E-AUTH-09", "E-AUTH-10"]) {
    assert.equal(matrix.flows.find((flow) => flow.id === id)?.status, "PASS");
  }
  assert.deepEqual(evidence.promotedFlows, ["E-AUTH-08", "E-AUTH-09", "E-AUTH-10"]);
  assert.equal(evidence.evidence.syntheticUserRemoved, true);
  assert.equal(evidence.evidence.originalAuthConfigurationRestored, true);
  assert.match(handoff, /fifth slice in the original six-slice Phase E plan/);
  assert.equal(
    packageJson.scripts["certify:phase-e:mobile-auth"],
    "node scripts/phase-e-mobile-auth-proof.mjs",
  );
});
