import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("valuation consumes the canonical RPC value instead of recalculating rounded cost value", async () => {
  const page = await source("src/app/(back-office)/back-office/inventory/page.tsx");

  assert.match(page, /rpc\("get_inventory_valuation"/);
  assert.match(page, /valueMinor: Number\(entry\.value_minor\)/);
  assert.match(page, /total \+ entry\.valueMinor/);
  assert.match(page, /RPC owns cost rounding/);
  assert.doesNotMatch(page, /entry\.quantity \* entry\.averageCostMinor/);
});

test("valuation exposes complete, explicitly qualified cost and price information", async () => {
  const page = await source("src/app/(back-office)/back-office/inventory/page.tsx");

  for (const label of [
    "Confirmed inventory value",
    "Current retail value",
    "Potential profit",
    "Potential margin",
    "Cost coverage",
    "Missing cost",
    "Archived",
    "Negative stock",
  ]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /Missing cost is not treated as zero value/);
  assert.match(page, /Potential profit ÷ current retail value/);
  assert.match(page, /product\?\.unit \?\? "units"/);
  assert.match(page, /price_override_minor/);
});

test("valuation remains a permission-checked, store-scoped read path", async () => {
  const [page, migration] = await Promise.all([
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
    source("supabase/migrations/20260829132029_inventory_read_cost_access_hardening.sql"),
  ]);

  assert.match(page, /const canViewCosts = hasPermission\(context, "products\.view_cost"\)/);
  assert.match(page, /activeTab === "valuation" && canViewCosts/);
  assert.match(migration, /private\.has_permission\(target_organization_id, 'products\.view_cost'\)/);
  assert.match(migration, /private\.has_store_read_scope\(target_organization_id, level\.store_id\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
});
