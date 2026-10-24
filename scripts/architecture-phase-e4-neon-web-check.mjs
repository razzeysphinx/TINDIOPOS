import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveWebAuthProvider } from "../src/lib/auth/provider.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("E4 keeps Supabase as the Web default and gates Neon to local proof", () => {
  assert.equal(resolveWebAuthProvider(undefined), "supabase");
  assert.throws(() => resolveWebAuthProvider("neon"));
  assert.equal(resolveWebAuthProvider("neon", {
    mode: "local",
    nodeEnvironment: "development",
    deploymentEnvironment: undefined,
    neonAuthBaseUrl: "https://ep-synthetic.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth",
  }), "neon");

  for (const rejected of [
    { mode: "off", nodeEnvironment: "development", deploymentEnvironment: undefined },
    { mode: "local", nodeEnvironment: "production", deploymentEnvironment: undefined },
    { mode: "local", nodeEnvironment: "development", deploymentEnvironment: "preview" },
  ]) {
    assert.throws(() => resolveWebAuthProvider("neon", {
      ...rejected,
      neonAuthBaseUrl: "https://ep-synthetic.neonauth.us-east-2.aws.neon.tech/neondb/auth",
    }));
  }
});

test("E4 adapter and proof route enforce synthetic-only isolation", async () => {
  const [adapter, actions, page, surface, sessionRoute, harness] = await Promise.all([
    read("src/lib/auth/neon-web-proof.ts"),
    read("src/features/auth/neon-proof-actions.ts"),
    read("src/app/(auth)/auth-proof/page.tsx"),
    read("src/features/auth/neon-proof-surface.tsx"),
    read("src/app/api/auth-proof/session/route.ts"),
    read("scripts/phase-e4-neon-web-proof.mjs"),
  ]);

  assert.match(adapter, /createNeonAuth/);
  assert.match(adapter, /NEON_AUTH_COOKIE_SECRET/);
  assert.match(adapter, /auth-proof\.tindio\.invalid/);
  assert.match(actions, /isSyntheticNeonProofEmail/);
  assert.match(page, /getNeonWebProofConfiguration/);
  assert.match(surface, /Local synthetic proof only/);
  assert.match(sessionRoute, /Cache-Control.*no-store/);
  assert.doesNotMatch(sessionRoute, /accessToken|access_token|session\.token/);
  assert.match(harness, /revoked cookie replay must not restore the session/);
  assert.doesNotMatch([adapter, actions, page, surface, sessionRoute, harness].join("\n"), /billowing-night|br-spring-shape|ep-round-sound/);
});

test("E4 pins the official SDK without changing deployment configuration", async () => {
  const [packageJson, gitignore, matrixSource, evidenceSource] = await Promise.all([
    read("package.json"),
    read(".gitignore"),
    read("docs/architecture/TINDIO_PHASE_E_AUTH_PROOF_MATRIX.json"),
    read("docs/architecture/TINDIO_PHASE_E4_NEON_WEB_PROOF.json"),
  ]);
  const parsed = JSON.parse(packageJson);
  const matrix = JSON.parse(matrixSource);
  const evidence = JSON.parse(evidenceSource);
  assert.equal(parsed.dependencies["@neondatabase/auth"], "0.6.0-beta");
  assert.equal(parsed.scripts["test:architecture-phase-e4-neon-web"], "node --test scripts/architecture-phase-e4-neon-web-check.mjs");
  assert.equal(parsed.scripts["certify:phase-e4:neon-web"], "node scripts/phase-e4-neon-web-proof.mjs");
  assert.match(gitignore, /\.env\*/);
  assert.deepEqual(
    matrix.flows.filter(({ status }) => status === "PASS").map(({ id }) => id),
    ["E-AUTH-01", "E-AUTH-03", "E-AUTH-06"],
  );
  assert.equal(matrix.flows.filter(({ status }) => status === "NOT_RUN").length, 10);
  assert.deepEqual(evidence.promotedFlows, ["E-AUTH-01", "E-AUTH-03", "E-AUTH-06"]);
  assert.equal(evidence.environment.supabaseRemainsDefault, true);
  assert.equal(evidence.environment.deployedConfigurationChanged, false);
});
