import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveBackendAuthProvider } from "../apps/backend/src/auth/provider.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const proofEnvironment = {
  TINDIO_AUTH_PROVIDER: "neon",
  TINDIO_AUTH_PROOF_MODE: "local",
  NODE_ENV: "test",
  NEON_AUTH_BASE_URL:
    "https://ep-synthetic.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth",
  NEON_AUTH_JWKS_URL:
    "https://ep-synthetic.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json",
};

test("E5 keeps Supabase default and gates Backend Neon selection", () => {
  assert.equal(resolveBackendAuthProvider(undefined), "supabase");
  assert.throws(() => resolveBackendAuthProvider("neon"));
  assert.equal(resolveBackendAuthProvider("neon", proofEnvironment), "neon");

  for (const rejected of [
    { ...proofEnvironment, TINDIO_AUTH_PROOF_MODE: "off" },
    { ...proofEnvironment, NODE_ENV: "production" },
    { ...proofEnvironment, VERCEL: "1" },
    { ...proofEnvironment, VERCEL_ENV: "preview" },
    { ...proofEnvironment, NEON_AUTH_JWKS_URL: "https://attacker.invalid/jwks.json" },
  ]) {
    assert.throws(() => resolveBackendAuthProvider("neon", rejected));
  }
});

test("E5 verifier and route enforce issuer, algorithm, role, and token secrecy", async () => {
  const [provider, service, route] = await Promise.all([
    read("apps/backend/src/auth/provider.ts"),
    read("apps/backend/src/auth/neon-proof-service.ts"),
    read("apps/backend/api/auth-proof/claims.ts"),
  ]);

  assert.match(provider, /createRemoteJWKSet/);
  assert.match(provider, /algorithms: \["EdDSA"\]/);
  assert.match(provider, /issuer: configuration\.issuer/);
  assert.match(provider, /role !== "authenticated"/);
  assert.match(provider, /client\.auth\.getClaims\(token\)/);
  assert.match(service, /Cache-Control": "no-store"/);
  assert.match(service, /verifier\.provider !== "neon"/);
  assert.doesNotMatch(service, /raw:|sessionId:|accessToken|access_token/);
  assert.match(route, /TINDIO_AUTH_PROOF_MODE/);
  assert.match(route, /VERCEL_ENV/);
});

test("E5 harness proves Backend and Data API denial/acceptance without merchant writes", async () => {
  const harness = await read("scripts/phase-e5-neon-backend-proof.mjs");

  for (const marker of [
    "missingTokenResponse.status, 401",
    "invalidTokenResponse.status, 401",
    "validTokenResponse.status, 200",
    "invalid Data API token must be denied",
    "rpc/current_profile_id",
    "resolvedProfileId",
    "synthetic proof session cleanup must succeed",
  ]) assert.match(harness, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.doesNotMatch(harness, /billowing-night|br-spring-shape|ep-round-sound/);
  assert.doesNotMatch(harness, /insert\s+into|update\s+profiles|delete\s+from/i);
});

test("E5 evidence promotes exactly two new flows and preserves cutover safety", async () => {
  const [rootPackageSource, backendPackageSource, matrixSource, evidenceSource] = await Promise.all([
    read("package.json"),
    read("apps/backend/package.json"),
    read("docs/architecture/TINDIO_PHASE_E_AUTH_PROOF_MATRIX.json"),
    read("docs/architecture/TINDIO_PHASE_E5_NEON_BACKEND_PROOF.json"),
  ]);
  const rootPackage = JSON.parse(rootPackageSource);
  const backendPackage = JSON.parse(backendPackageSource);
  const matrix = JSON.parse(matrixSource);
  const evidence = JSON.parse(evidenceSource);

  assert.equal(backendPackage.dependencies.jose, "6.2.5");
  assert.equal(
    rootPackage.scripts["test:architecture-phase-e5-neon-backend"],
    "node --test scripts/architecture-phase-e5-neon-backend-check.mjs",
  );
  assert.equal(
    rootPackage.scripts["certify:phase-e5:neon-backend"],
    "pnpm backend:build && node scripts/phase-e5-neon-backend-proof.mjs",
  );
  assert.ok(matrix.executedFlowCount >= 5);
  assert.ok(matrix.passedFlowCount >= 5);
  const passedFlows = matrix.flows.filter(({ status }) => status === "PASS").map(({ id }) => id);
  for (const id of ["E-AUTH-01", "E-AUTH-03", "E-AUTH-05", "E-AUTH-06", "E-AUTH-11"]) {
    assert.ok(passedFlows.includes(id));
  }
  assert.deepEqual(evidence.promotedFlows, ["E-AUTH-05", "E-AUTH-11"]);
  assert.equal(evidence.environment.supabaseRemainsDefault, true);
  assert.equal(evidence.environment.deployedConfigurationChanged, false);
  assert.equal(evidence.environment.merchantRowsWritten, 0);
  assert.equal(evidence.evidence.syntheticSessionSignedOut, true);
});
