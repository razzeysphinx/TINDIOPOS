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

test("valuation keeps zero and unverified costs distinct in the canonical read path", async () => {
  const [page, migration] = await Promise.all([
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
    source("supabase/migrations/20260911065054_inventory_valuation_cost_truth.sql"),
  ]);

  assert.match(page, /const canViewCosts = hasPermission\(context, "products\.view_cost"\)/);
  assert.match(page, /const canViewValuation = hasPermission\(context, "products\.view_cost"\)/);
  assert.match(page, /activeTab === "valuation" && canViewValuation/);
  assert.match(page, /costAvailable: entry\.value_minor !== null/);
  assert.match(page, /entry\.costAvailable \? formatMoney\(entry\.averageCostMinor/);
  assert.doesNotMatch(page, /averageCostMinor > 0/);

  assert.match(migration, /add column if not exists cost_is_known boolean not null default false/);
  assert.match(migration, /add column if not exists unit_cost_is_known boolean not null default false/);
  assert.match(migration, /capture_stock_transfer_line_cost_truth/);
  assert.match(migration, /components_cost_known := components_cost_known and component_level\.cost_is_known/);
  assert.match(migration, /when level\.cost_is_known then round\(level\.quantity \* level\.average_cost_minor\)::bigint/);
  assert.match(migration, /else null::bigint/);
});

test("valuation remains capability-checked and store-scoped", async () => {
  const migration = await source("supabase/migrations/20260911065054_inventory_valuation_cost_truth.sql");

  assert.match(migration, /private\.has_permission\(target_organization_id, 'products\.view_cost'\)/);
  assert.match(migration, /private\.has_inventory_capability\(target_organization_id, 'inventory\.valuation\.view'\)/);
  assert.match(migration, /private\.has_store_read_scope\(target_organization_id, level\.store_id\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
});
