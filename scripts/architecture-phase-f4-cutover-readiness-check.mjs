import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("F4 readiness package fails closed until every external gate is approved", async () => {
  const readiness = JSON.parse(
    await read("docs/architecture/TINDIO_PHASE_F_CUTOVER_READINESS.json"),
  );
  assert.equal(readiness.status, "PREPARED_STOP_REQUIRED");
  assert.equal(readiness.decision, "DO_NOT_CUT_OVER");
  assert.equal(readiness.productionChangesMade, false);
  assert.equal(readiness.ownerApprovalRecorded, false);
  assert.ok(readiness.openGates.length >= 7);
  for (const stop of [
    "real_user_import_or_creation",
    "identity_link_writes",
    "production_neon_auth_enablement",
    "live_client_cutover",
    "supabase_decommission",
  ]) assert.ok(readiness.prohibitedUntilApproval.includes(stop));
});

test("F4 documentation retains explicit owner approval and rollback boundaries", async () => {
  const [checklist, mappingPlan, migration, certification, packageSource] =
    await Promise.all([
      read("docs/architecture/TINDIO_PRODUCTION_CUTOVER_CHECKLIST.md"),
      read("docs/architecture/TINDIO_IDENTITY_MAPPING_PLAN.md"),
      read("docs/architecture/TINDIO_MIGRATION_SEQUENCE.md"),
      read("docs/architecture/TINDIO_ARCHITECTURE_CERTIFICATION.md"),
      read("package.json"),
    ]);
  assert.match(checklist, /NOT READY.*OWNER APPROVAL REQUIRED/);
  assert.match(checklist, /Explicit owner approval recorded for production provisioning\/import/);
  assert.match(checklist, /Rollback remains viable/);
  assert.match(mappingPlan, /F4 PREPARED/);
  assert.match(migration, /Phase F4: cutover readiness package/);
  assert.match(certification, /PHASE F2 AND F3 COMPLETE; F4 PREPARED/);
  const packageJson = JSON.parse(packageSource);
  assert.equal(
    packageJson.scripts["test:architecture-phase-f4-cutover-readiness"],
    "node --test scripts/architecture-phase-f4-cutover-readiness-check.mjs",
  );
});
