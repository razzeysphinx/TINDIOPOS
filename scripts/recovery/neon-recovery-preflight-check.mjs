import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/recovery/neon-recovery-preflight.mjs", "utf8");

test("recovery preflight pins the audited migration ancestor", () => {
  assert.match(source, /2d48e2ead33d783aef6c61dedb661ba74714ea9a/);
  assert.match(source, /AUDITED_HISTORICAL_MIGRATION_COUNT[\s\S]*211/);
});

test("recovery preflight verifies historical migration bytes", () => {
  assert.match(source, /git[\s\S]*show/);
  assert.match(source, /sha256/);
  assert.match(source, /Historical migration was modified/);
});

test("recovery preflight allows dynamic forward recovery migrations", () => {
  assert.match(source, /recoveryFiles/);
  assert.doesNotMatch(source, /RECOVERY_FORWARD_MIGRATION_COUNT/);
  assert.doesNotMatch(source, /EXPECTED_MIGRATION_COUNT/);
});
