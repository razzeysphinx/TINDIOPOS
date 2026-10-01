import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const count = (source, pattern) => Array.from(source.matchAll(pattern)).length;

test("R5 management and catalog reads use canonical bounded bundles", () => {
  const management = read("src/features/management/data.ts");
  const catalog = read("src/features/catalog/data.ts");
  const managementModel = read("src/features/management/management-read-model.ts");
  const catalogModel = read("src/features/catalog/catalog-read-model.ts");
  const migration = read("database/migrations/0008_r5_management_catalog_read_models.sql");
  assert.ok(count(management, /\.from\s*\(/g) <= 3);
  assert.equal(count(catalog, /\.from\s*\(/g), 0);
  assert.equal(count(managementModel, /\.from\s*\(/g), 0);
  assert.equal(count(catalogModel, /\.from\s*\(/g), 0);
  assert.equal(count(managementModel, /\.rpc\s*\(/g), 1);
  assert.equal(count(catalogModel, /\.rpc\s*\(/g), 1);
  assert.match(managementModel, /get_management_workspace_bundle_v1/);
  assert.match(catalogModel, /get_catalog_workspace_bundle_v1/);
  assert.match(catalog, /get_catalog_costs/);
  assert.match(management, /get_customer_display_management_sessions/);
  assert.match(management, /get_pos_shift_operational_summary/);
  assert.match(management, /get_employee_management_detail/);
  assert.equal(count(migration, /security\s+invoker/gi), 2);
  assert.doesNotMatch(migration, /security\s+definer|auth\.(uid|jwt|role|user_id)\s*\(/i);
  assert.match(migration, /tindio_authenticated/i);
});
