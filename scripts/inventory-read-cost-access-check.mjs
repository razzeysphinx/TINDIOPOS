import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("Phase 8 permits inventory read access without exposing mutation workspaces", async () => {
  const inventoryPage = await source("src/app/(back-office)/back-office/inventory/page.tsx");
  const layout = await source("src/app/(back-office)/back-office/layout.tsx");
  const dal = await source("src/lib/auth/dal.ts");

  assert.match(inventoryPage, /requireBackOfficePermission\(\["inventory\.view", "inventory\.manage"\]\)/);
  assert.match(inventoryPage, /requestedTab === "stock" \|\| requestedTab === "activity"/);
  assert.match(inventoryPage, /INVENTORY_TABS\.filter\(\(tab\) => tab\.id === "stock" \|\| tab\.id === "activity"\)/);
  assert.match(layout, /permission === "inventory\.view" \|\| permission === "inventory\.manage"/);
  assert.match(dal, /"inventory\.view",\n  "inventory\.manage"/);
  assert.match(dal, /hasAnyPermission\(context, \["inventory\.view", "inventory\.manage"\]\)/);
});

test("Phase 8 never serializes raw inventory cost fields to client workspaces", async () => {
  const inventoryPage = await source("src/app/(back-office)/back-office/inventory/page.tsx");

  assert.match(inventoryPage, /from\("inventory_levels"\)\n    \.select\("id, store_id, product_id, variant_id, quantity, updated_at"\)/);
  assert.match(inventoryPage, /from\("purchase_order_lines"\)\n          \.select\("id, purchase_order_id, product_id, variant_id, product_name_snapshot, variant_name_snapshot, unit_snapshot, ordered_quantity, received_quantity"\)/);
  assert.match(inventoryPage, /rpc\("get_inventory_valuation"/);
  assert.match(inventoryPage, /rpc\("get_inventory_movement_costs"/);
  assert.match(inventoryPage, /rpc\("get_purchase_order_line_costs"/);
  assert.match(inventoryPage, /for \(let start = 0; start < purchaseOrderLineIds\.length; start \+= 100\)/);
  assert.match(inventoryPage, /requested_purchase_order_line_ids: purchaseOrderLineIds\.slice\(start, start \+ 100\)/);
  assert.match(inventoryPage, /permission-checked cost RPC/);
});

test("Phase 8 keeps inventory cost retrieval permission-checked and store-scoped", async () => {
  const migration = await source("supabase/migrations/20260829132029_inventory_read_cost_access_hardening.sql");

  assert.match(migration, /inventory_levels_select_authorized_scope/);
  assert.match(migration, /'inventory\.view'/);
  assert.match(migration, /private\.has_store_read_scope\(organization_id, store_id\)/);
  assert.match(migration, /revoke select on table public\.inventory_levels from authenticated/);
  assert.match(migration, /revoke select on table public\.inventory_movements from authenticated/);
  assert.match(migration, /revoke select on table public\.purchase_order_lines from authenticated/);
  assert.match(migration, /create or replace function public\.get_inventory_valuation/);
  assert.match(migration, /create or replace function public\.get_inventory_movement_costs/);
  assert.match(migration, /create or replace function public\.get_purchase_order_line_costs/);
  assert.match(migration, /private\.has_permission\(target_organization_id, 'products\.view_cost'\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
});
