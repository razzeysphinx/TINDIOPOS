import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root));

test("I4 evidence manifest hashes match the preserved repository artifacts", async () => {
  const manifest = JSON.parse(await read("docs/architecture/TINDIO_PHASE_I4_ARCHIVE_MANIFEST.json"));
  for (const artifact of manifest.artifacts) {
    const digest = createHash("sha256").update(await read(artifact.path)).digest("hex");
    assert.equal(digest, artifact.sha256, artifact.path);
  }
});

test("I4 manifest stores no secret material and does not overclaim external proof", async () => {
  const manifest = JSON.parse(await read("docs/architecture/TINDIO_PHASE_I4_ARCHIVE_MANIFEST.json"));
  assert.equal(manifest.containsSecrets, false);
  assert.equal(manifest.repositoryEvidenceVerified, true);
  assert.equal(manifest.providerExportVerified, false);
  assert.equal(manifest.externalBackupVerified, false);
  assert.equal(manifest.restoreDrillPassed, false);
  assert.equal(manifest.retirementAllowed, false);
  assert.equal(manifest.artifacts.some(({ path }) => /\.env|secret|token/i.test(path)), false);
});
