import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceOfTruthUrl = new URL(
  "../docs/TINDIO_MOBILE_NEON_SOURCE_OF_TRUTH.md",
  import.meta.url,
);

const source = await readFile(sourceOfTruthUrl, "utf8");

const expectedPhases = Array.from(
  { length: 27 },
  (_, index) => String(index).padStart(2, "0"),
);

test("mobile program source of truth remains explicitly locked", () => {
  assert.match(
    source,
    /MASTER SOURCE OF TRUTH\s+[—-]\s+LOCKED v1\.0/i,
  );

  assert.match(
    source,
    /THIS DOCUMENT WINS/i,
  );

  assert.match(
    source,
    /DO NOT RENUMBER OR REORDER THESE PHASES WITHOUT EXPLICIT USER APPROVAL/i,
  );
});

test("mobile program retains the complete locked Phase 00 through Phase 26 sequence", () => {
  const phases = [
    ...source.matchAll(/^## PHASE (\d{2})\s+[—-]\s+/gm),
  ].map((match) => match[1]);

  assert.deepEqual(
    phases,
    expectedPhases,
    "The locked mobile program must contain exactly one ordered Phase 00 through Phase 26 sequence.",
  );
});

test("backend v1 architecture lock remains between Neon certification and native Android", () => {
  const phase05 = source.indexOf(
    "## PHASE 05 — NEON STABILIZATION + FINAL BACKEND CERTIFICATION",
  );

  const backendLock = source.indexOf(
    "BACKEND V1 ARCHITECTURE LOCK",
    phase05,
  );

  const phase06 = source.indexOf(
    "## PHASE 06 — NATIVE ANDROID FOUNDATION",
  );

  assert.ok(phase05 >= 0, "Phase 05 heading is missing.");
  assert.ok(backendLock > phase05, "Backend V1 lock must follow Phase 05.");
  assert.ok(phase06 > backendLock, "Native Android must remain after the Backend V1 lock.");
});

test("critical tenant and repository-scan rules remain present", () => {
  assert.match(
    source,
    /SCAN BEFORE MODIFYING/i,
  );

  assert.match(
    source,
    /Business A must NEVER be able to read or mutate Business B data/i,
  );

  assert.match(
    source,
    /Never implement last-write-wins stock replacement/i,
  );

  assert.match(
    source,
    /TINDIO IS NOT BEING REBUILT/i,
  );
});
