import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const script = readFileSync("scripts/recovery/refresh-local-database-types-contract.mjs", "utf8");

test("database type refresh is pinned to local Supabase", () => {
  assert.match(script, /parseAndValidateLocalSupabaseStatus/);
  assert.match(script, /supabase[\s\S]*status[\s\S]*--output[\s\S]*json/);
});

test("database type refresh uses the canonical generator", () => {
  assert.match(script, /scripts\/generate-local-database-types\.mjs/);
});

test("database type refresh preserves key TINDIO contracts", () => {
  for (const marker of [
    "current_profile_id", "organizations:", "stores:", "employees:", "products:",
    "inventory_levels:", "inventory_movements:", "sales:", "payments:", "receipts:",
    "get_pos_device_sync_checkpoint",
  ]) {
    assert.match(script, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("database type refresh does not bypass certification", () => {
  assert.doesNotMatch(script, /certification-contract\.mjs/);
  assert.doesNotMatch(script, /verifyGeneratedTextContract/);
});
