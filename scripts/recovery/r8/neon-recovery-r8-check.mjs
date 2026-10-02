import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");
const [proxy, mobileOutbox, finalSync, reset, common, sourceOfTruth] = await Promise.all([
  read("src/proxy.ts"),
  read("apps/mobile/src/features/outbox/outbox-sync.ts"),
  read("scripts/recovery/r8/neon-recovery-r8-final-sync.mjs"),
  read("scripts/recovery/r8/neon-recovery-r8-target-reset.mjs"),
  read("scripts/recovery/r8/common.mjs"),
  read("docs/recovery/TINDIO_NEON_RECOVERY_SOURCE_OF_TRUTH.md"),
]);

for (const marker of ["TINDIO_CUTOVER_MODE", "TINDIO_CUTOVER_BYPASS_SECRET", "CUTOVER_MAINTENANCE", "Retry-After", "Cache-Control", "pathname.startsWith(\"/api/\")", "url.pathname = maintenancePath"]) {
  assert.ok(proxy.includes(marker), `Missing R8 proxy marker: ${marker}`);
}
assert.ok(mobileOutbox.includes("response.status >= 500"), "Mobile outbox must retain retryable 5xx handling during maintenance.");
assert.ok(finalSync.includes("scripts/recovery/r7/neon-recovery-r7-migrate.mjs"), "R8 final sync must reuse the R7 migration engine.");
assert.ok(finalSync.includes("TINDIO_R8_FINALIZE_EXISTING_REHEARSAL"), "R8 final sync must support explicit no-reset rehearsal finalization.");
assert.ok(!finalSync.includes("phase-04-neon-migrate.mjs"), "R8 final sync must not use the obsolete Phase-04 migrator.");
assert.ok(reset.includes("assertR8TargetWriteAuthorized"), "R8 reset must invoke the shared target-write authorization guard.");
for (const marker of ["TINDIO_R8_REMOTE_WRITE", "TINDIO_R8_WRITE_FREEZE_CONFIRMED", "TINDIO_R8_CUTOVER_AUTHORIZED", "TINDIO_R8_REHEARSAL_AUTHORIZED"]) {
  assert.ok(common.includes(marker), `Missing R8 cutover guard: ${marker}`);
}
for (const marker of ["TRUNCATE TABLE", "RESTART IDENTITY", "without CASCADE"]) {
  assert.ok(reset.includes(marker), `Missing R8 reset safety marker: ${marker}`);
}
assert.match(sourceOfTruth, /^R7  COMPLETE$/m);
assert.match(sourceOfTruth, /^R8  COMPLETE$/m);
assert.match(sourceOfTruth, /^R9  NEXT \/ NOT STARTED$/m);
console.log("TINDIO R8 AUTOMATED CONTRACT: PASS");
