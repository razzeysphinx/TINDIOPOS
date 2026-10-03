import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [migration, posData, posBootstrap, dashboard, reports] = await Promise.all([
  read("../../database/migrations/0009_r5_pos_reporting_read_models.sql"),
  read("../../src/features/pos/data.ts"),
  read("../../src/features/pos/pos-bootstrap-data.ts"),
  read("../../src/features/dashboard/data.ts"),
  read("../../src/features/reports/data.ts"),
]);

test("R5 POS, dashboard, and reports reads use canonical bounded models", () => {
  assert.equal((posData.match(/\.from\(/g) ?? []).length, 1);
  assert.match(posData, /loadPosBootstrapBundleResult/);
  assert.equal((posBootstrap.match(/\.from\(/g) ?? []).length, 0);
  assert.equal((posBootstrap.match(/\.rpc\(/g) ?? []).length, 1);
  assert.equal((dashboard.match(/\.from\(/g) ?? []).length, 0);
  assert.equal((reports.match(/\.from\(/g) ?? []).length, 0);
  for (const name of ["get_pos_bootstrap_bundle_v1", "get_dashboard_readiness_snapshot_v1", "get_reports_store_reference_v1"]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${name}`));
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}`));
  }
  assert.match(posData, /search_pos_catalog|get_pos_favorite_items|get_pos_recent_items/);
  assert.match(posData, /get_pos_customer_display_sessions_with_ids/);
  assert.doesNotMatch(migration, /security definer|auth\.(uid|jwt|role|user_id)\s*\(/i);
  assert.match(migration, /security invoker/g);
  assert.match(migration, /tindio_authenticated/g);
});
