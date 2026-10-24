import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("E6 lifecycle actions remain local, synthetic-only, and secret-safe", async () => {
  const [adapter, actions, route, harness] = await Promise.all([
    read("src/lib/auth/neon-web-proof.ts"),
    read("src/features/auth/neon-proof-actions.ts"),
    read("src/app/api/auth-proof/session/route.ts"),
    read("scripts/phase-e6-neon-web-lifecycle-proof.mjs"),
  ]);

  assert.match(adapter, /TINDIO_AUTH_PROOF_ORIGIN/);
  assert.match(adapter, /\["localhost", "127\.0\.0\.1"\]/);
  assert.match(actions, /isSyntheticNeonProofEmail/);
  assert.match(actions, /emailOtp\.verifyEmail/);
  assert.match(actions, /requestPasswordReset/);
  assert.match(actions, /resetPassword/);
  assert.match(route, /handleAuthProxyRequest/);
  assert.match(route, /headers\.getSetCookie\(\)/);
  assert.match(route, /emailVerified/);
  assert.doesNotMatch(route, /session\.token|accessToken|access_token/);
  assert.doesNotMatch([adapter, actions, route, harness].join("\n"), /billowing-night|br-spring-shape|ep-round-sound/);
});

test("E6 harness restores branch configuration and directly proves three lifecycle flows", async () => {
  const harness = await read("scripts/phase-e6-neon-web-lifecycle-proof.mjs");

  for (const marker of [
    "event=verification-required",
    "event=email-verified",
    "session_data",
    "session_token",
    "event=recovery-requested",
    "event=password-reset",
    "setEmailPasswordConfiguration(originalConfiguration)",
    "E-AUTH-02",
    "E-AUTH-04",
    "E-AUTH-07",
  ]) assert.match(harness, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.doesNotMatch(harness, /console\.log\([^)]*(?:password|token|otp)/i);
  assert.doesNotMatch(harness, /insert\s+into|update\s+(?:profiles|organizations)|delete\s+from/i);
});

test("E6 evidence promotes three Web flows and retains five unexecuted gates", async () => {
  const [packageSource, matrixSource, evidenceSource] = await Promise.all([
    read("package.json"),
    read("docs/architecture/TINDIO_PHASE_E_AUTH_PROOF_MATRIX.json"),
    read("docs/architecture/TINDIO_PHASE_E6_NEON_WEB_LIFECYCLE_PROOF.json"),
  ]);
  const packageJson = JSON.parse(packageSource);
  const matrix = JSON.parse(matrixSource);
  const evidence = JSON.parse(evidenceSource);

  assert.equal(
    packageJson.scripts["certify:phase-e6:neon-web-lifecycle"],
    "node scripts/phase-e6-neon-web-lifecycle-proof.mjs",
  );
  assert.equal(matrix.executedFlowCount, 8);
  assert.equal(matrix.passedFlowCount, 8);
  assert.equal(matrix.flows.filter(({ status }) => status === "NOT_RUN").length, 5);
  assert.deepEqual(evidence.promotedFlows, ["E-AUTH-02", "E-AUTH-04", "E-AUTH-07"]);
  assert.equal(evidence.environment.supabaseRemainsDefault, true);
  assert.equal(evidence.environment.deployedConfigurationChanged, false);
  assert.equal(evidence.environment.merchantRowsWritten, 0);
  assert.equal(evidence.evidence.originalAuthConfigurationRestored, true);
  assert.equal(evidence.evidence.strayCanonicalSyntheticIdentityCountAfterCleanup, 0);
});
