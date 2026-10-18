import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("apps/mobile/app/(app)/pos.tsx", "utf8");

test("MOB-13 register setup fallback uses the shared mobile UI system", () => {
  assert.match(source, /testID="pos-setup-state"/);
  assert.match(source, /<TindioCard style=\{styles\.unavailableCard\}>/);
  assert.match(source, /kind=\{preparing \? "loading" : "restriction"\}/);
  assert.match(source, /title=\{preparing \? "Checking register" : "Catalog unavailable"\}/);
  assert.match(source, /Try again/);
  assert.match(source, /Back to register/);
  assert.doesNotMatch(source, /<Text>\s*Local catalog is not prepared\.\s*<\/Text>/);
});

test("MOB-13 register setup fallback preserves custody and retries existing providers", () => {
  assert.match(source, /await reload\(\);\s*await terminal\.reload\(\);/);
  assert.match(source, /Saved work remains on this device\./);
  assert.doesNotMatch(source, /DELETE FROM|DROP TABLE|clearDatabase|resetDatabase/);
});
