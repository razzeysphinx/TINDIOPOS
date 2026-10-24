import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const matrix = JSON.parse(await read("docs/architecture/TINDIO_PHASE_E_AUTH_PROOF_MATRIX.json"));

test("E1 freezes exactly thirteen synthetic-only Auth proof flows", () => {
  assert.equal(matrix.phase, "E");
  assert.equal(matrix.slice, "E1");
  assert.equal(matrix.status, "PLANNED_NOT_RUN");
  assert.equal(matrix.syntheticOnly, true);
  assert.equal(matrix.flows.length, 13);
  assert.equal(matrix.requiredFlowCount, 13);
  assert.equal(new Set(matrix.flows.map((flow) => flow.id)).size, 13);
  assert.deepEqual([...new Set(matrix.flows.map((flow) => flow.surface))].sort(), ["Backend", "Data API", "Database", "Mobile", "Rollback", "Web"]);
  assert.ok(matrix.flows.every((flow) => flow.status === "NOT_RUN"));
});

test("E1 retains its original provider and branch findings after E2", async () => {
  const source = await read("docs/architecture/TINDIO_PHASE_E_NEON_AUTH_PREREQUISITES.md");
  for (const marker of ["E2 ISOLATED PROVISIONING COMPLETE", "divine-sound-41148108", "br-snowy-heart-b5nf6q3n", "aws-us-east-2", "Neon Auth is not configured for this branch", "CLI 4.14.3"]) assert.ok(source.includes(marker), `missing ${marker}`);
});

test("E1 preserves Supabase Auth and external-JWT Data API configuration", async () => {
  const neon = await read("neon.ts");
  assert.match(neon, /auth:\s*true/);
  assert.match(neon, /authProvider:\s*["']external["']/);
  assert.match(neon, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(neon, /Supabase Auth/);
  assert.doesNotMatch(neon, /authProvider:\s*["']neon["']/);
});

test("E1 keeps current Web, Mobile, and Backend Supabase session paths intact", async () => {
  const sources = await Promise.all([
    read("src/lib/supabase/server.ts"),
    read("src/lib/supabase/client.ts"),
    read("apps/mobile/src/lib/supabase.ts"),
    read("apps/mobile/src/features/session/session-provider.tsx"),
    read("apps/backend/src/pos/bootstrap-runtime.ts"),
    read("apps/backend/src/pos/pos-read-runtime.ts"),
  ]);
  assert.match(sources[0], /createServerClient/);
  assert.match(sources[1], /createBrowserClient/);
  assert.match(sources[2], /@supabase\/supabase-js/);
  assert.match(sources[3], /signInWithPassword/);
  assert.match(sources[3], /refreshSession/);
  assert.match(sources[4], /verifyClaims:\s*runtime\.verifyClaims/);
  assert.match(sources[5], /getClaims/);
});

test("E1 fails closed on branch, password, email, Mobile, and rollback decisions", async () => {
  const source = await read("docs/architecture/TINDIO_PHASE_E_NEON_AUTH_PREREQUISITES.md");
  for (const decision of ["Disposable branch approval", "Password continuity policy", "Synthetic identity and email policy", "Mobile proof path", "Rollback authority"]) assert.ok(source.includes(decision), `missing ${decision}`);
  assert.match(source, /existing\s+Supabase password hashes cannot migrate/);
  assert.match(source, /Do not create the branch, enable Neon Auth/);
});

test("E1 remains an executable historical gate without provider-cutover evidence", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  assert.match(packageJson.scripts["test:architecture-phase-e-auth-prerequisites"], /architecture-phase-e-auth-prerequisites-check\.mjs/);
  assert.match(await read("docs/architecture/TINDIO_MIGRATION_SEQUENCE.md"), /Completed Slice E1: Neon Auth prerequisite assessment/);
  assert.match(await read("docs/architecture/TINDIO_ARCHITECTURE_CERTIFICATION.md"), /The E1 prerequisite assessment used only repository inspection/);
});
