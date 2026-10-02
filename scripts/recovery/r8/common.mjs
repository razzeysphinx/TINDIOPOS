import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import {
  SOURCE,
  TARGET,
  identity,
  sanitizedIdentity,
  sourceUrl,
  targetUrl,
} from "../r7/common.mjs";

export const R8_STARTING_HEAD =
  "4a169ae1aef2e09edf59b87f36090a8c6fde0307";

export const R8_EVIDENCE_DIRECTORY =
  "docs/recovery/evidence/r8";

export const TARGET_DATA_API_HOST =
  TARGET.host.replace(
    ".c-7.",
    ".apirest.c-7.",
  );

export function canonicalR8Environment() {
  return {
    ...process.env,
    TINDIO_CANONICAL_MIGRATION_PHASE: "R8",
    TINDIO_CANONICAL_MIGRATION_EVIDENCE_DIRECTORY:
      R8_EVIDENCE_DIRECTORY,
    TINDIO_CANONICAL_MIGRATION_REMOTE_WRITE_GUARD:
      "TINDIO_R8_REMOTE_WRITE",
  };
}

export function assertR8CutoverAuthorized() {
  for (
    const name
    of [
      "TINDIO_R8_REMOTE_WRITE",
      "TINDIO_R8_WRITE_FREEZE_CONFIRMED",
      "TINDIO_R8_CUTOVER_AUTHORIZED",
    ]
  ) {
    assert.equal(
      process.env[name],
      "YES",
      `Set ${name}=YES only during the explicitly authorized R8 cutover window.`,
    );
  }
}

export async function readClassification() {
  return JSON.parse(
    await readFile(
      `${R8_EVIDENCE_DIRECTORY}/table-classification.json`,
      "utf8",
    ),
  );
}

export async function writeR8Evidence(
  name,
  value,
) {
  await mkdir(
    R8_EVIDENCE_DIRECTORY,
    { recursive: true },
  );

  await writeFile(
    `${R8_EVIDENCE_DIRECTORY}/${name}`,
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

export async function verifiedIdentities() {
  const source = await sourceUrl();
  const target = targetUrl();

  assert.notEqual(
    new URL(source).hostname,
    new URL(target).hostname,
    "R8 source and target must differ.",
  );

  const sourceIdentity = identity(source);
  const targetIdentity = identity(target);

  assert.equal(sourceIdentity.readOnly, true);
  assert.equal(targetIdentity.readOnly, true);

  return {
    source,
    target,
    sourceIdentity: sanitizedIdentity(
      SOURCE,
      sourceIdentity,
    ),
    targetIdentity: sanitizedIdentity(
      TARGET,
      targetIdentity,
    ),
  };
}
