import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const count = (source, pattern) => (source.match(pattern) ?? []).length;

test("R5 final recovery contract remains complete and provider-neutral", () => {
  const sourceOfTruth = read("docs/recovery/TINDIO_NEON_RECOVERY_SOURCE_OF_TRUTH.md");
  const inventory = read("src/app/(back-office)/back-office/inventory/page.tsx");
  const replenishment = read("src/app/(back-office)/back-office/replenishment/page.tsx");
  const catalog = read("src/features/catalog/data.ts");
  const dashboard = read("src/features/dashboard/data.ts");
  const reports = read("src/features/reports/data.ts");
  const pos = read("src/features/pos/data.ts");
  assert.match(sourceOfTruth, /# R0[\s\S]*?# R9/);
  assert.match(sourceOfTruth, /R5\s+COMPLETE/);
  assert.match(sourceOfTruth, /# R6\s+—\s+CLEAN NEON REBUILD \+ PORTABILITY CERTIFICATION/);
  assert.equal(count(replenishment, /\.from\s*\(/g) + count(replenishment, /\.rpc\s*\(/g), 0);
  assert.equal(count(inventory, /\.from\("[a-z_]+"\)/g), 0);
  assert.equal(count(catalog, /\.from\s*\(/g), 0);
  assert.equal(count(dashboard, /\.from\s*\(/g), 0);
  assert.equal(count(reports, /\.from\s*\(/g), 0);
  assert.ok(count(pos, /\.from\s*\(/g) <= 1);
  for (const migration of ["0004_inventory_replenishment_read_models.sql", "0005_inventory_core_read_model_extension.sql", "0006_inventory_purchasing_read_model.sql", "0007_inventory_specialized_read_models.sql", "0008_r5_management_catalog_read_models.sql", "0009_r5_pos_reporting_read_models.sql", "0010_r5_residual_read_models.sql"]) {
    const source = read(`database/migrations/${migration}`);
    assert.doesNotMatch(source, /security\s+definer|auth\.(uid|jwt|role|user_id)\s*\(/i);
  }
});
