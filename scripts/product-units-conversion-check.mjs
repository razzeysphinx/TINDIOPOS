import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, service, actions, workspace, phase09] = await Promise.all([
  source("supabase/migrations/20260918030903_canonical_product_units.sql"),
  source("src/features/catalog/service.ts"),
  source("src/features/catalog/actions.ts"),
  source("src/features/catalog/catalog-product-workspace.tsx"),
  source("supabase/migrations/20260918023953_canonical_purchasing_receiving.sql"),
]);

test("base identity and exact per-product conversion remain protected", () => {
  assert.match(migration, /The base unit code and conversion factor are immutable/);
  assert.match(migration, /The base unit cannot be deleted/);
  assert.match(migration, /new\.is_base is distinct from old\.is_base/);
  assert.match(migration, /target_factor_to_base numeric/);
});

test("canonical product-unit commands own every reachable application mutation", () => {
  for (const command of ["create_product_unit", "update_product_unit", "delete_product_unit"]) {
    assert.match(service, new RegExp(`rpc\\(\"${command}\"`));
    assert.match(migration, new RegExp(`public\\.${command}`));
  }
  assert.doesNotMatch(service, /from\("product_units"\)\.(?:insert|update|delete)/);
  assert.match(actions, /hasPermission\(context, "products\.manage"\)/);
  assert.match(workspace, /Historical transactions keep their snapshots/);
});

test("operation identity, audit, grants, and Phase 09 snapshots are preserved", () => {
  assert.match(migration, /private\.product_unit_operations/);
  assert.match(migration, /pg_catalog\.pg_advisory_xact_lock/);
  assert.match(migration, /existing\.normalized_payload <> target_payload/);
  assert.match(migration, /PRODUCT_UNIT_CREATED/);
  assert.match(migration, /PRODUCT_UNIT_UPDATED/);
  assert.match(migration, /PRODUCT_UNIT_DELETED/);
  assert.match(migration, /revoke insert, update, delete on public\.product_units from authenticated/);
  assert.match(migration, /grant select on public\.product_units to authenticated/);
  for (const snapshot of ["base_quantity_received", "purchase_unit_code_snapshot", "purchase_unit_factor_to_base", "purchase_unit_cost_minor", "stock_unit_cost_minor"]) {
    assert.match(phase09, new RegExp(snapshot));
  }
});
