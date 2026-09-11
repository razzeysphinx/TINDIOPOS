import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("Inventory read and count access do not expose unrelated mutation workspaces", async () => {
  const [inventoryPage, stockRestockPage, navigation] = await Promise.all([
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
    source("src/app/(back-office)/back-office/replenishment/page.tsx"),
    source("src/features/inventory/inventory-workspace-navigation.tsx"),
  ]);
  const layout = await source("src/app/(back-office)/back-office/layout.tsx");
  const dal = await source("src/lib/auth/dal.ts");

  // Legacy permissions and granular capabilities are both supported so
  // existing custom roles remain compatible while new roles stay scoped.
  for (const permission of [
    "inventory.view",
    "inventory.adjust",
    "inventory.count",
    "inventory.manage",
    "inventory.count.create",
    "inventory.count.finalize",
    "inventory.valuation.view",
  ]) {
    assert.match(inventoryPage, new RegExp(`"${permission.replaceAll(".", "\\.")}"`));
  }
  assert.match(inventoryPage, /canViewValuation && requestedTab === "valuation"/);
  assert.match(inventoryPage, /const fallbackControlTab: InventoryControlTab/);
  assert.match(inventoryPage, /canViewValuation\s+\? "valuation"/);
  assert.match(inventoryPage, /redirect\(`\/back-office\/inventory\?\$\{query\.toString\(\)\}`\)/);
  assert.match(stockRestockPage, /if \(!canManage && !canAccessTransfers && activeTab !== "levels"\)/);
  assert.match(navigation, /canView && \(item\.id === "overview" \|\| item\.id === "activity"\)/);
  assert.match(navigation, /canCount && item\.id === "counts"/);
  assert.match(navigation, /canViewValuation && item\.id === "valuation"/);
  assert.match(navigation, /canManage \|\| canTransfer \|\| item\.id === "levels"/);
  assert.match(layout, /permission === "inventory\.count\.create"/);
  assert.match(layout, /permission === "inventory\.count\.finalize"/);
  assert.match(dal, /"inventory\.view"/);
  assert.match(dal, /"inventory\.count\.create"/);
  assert.match(dal, /"inventory\.count\.finalize"/);
});

test("Phase 8 never serializes raw inventory cost fields to client workspaces", async () => {
  const inventoryPage = await source("src/app/(back-office)/back-office/inventory/page.tsx");

  assert.match(inventoryPage, /from\("inventory_levels"\)[\s\S]{0,120}\.select\("id, store_id, product_id, variant_id, quantity, updated_at"\)/);
  assert.match(inventoryPage, /from\("purchase_order_lines"\)[\s\S]{0,320}\.select\("id, purchase_order_id, product_id, variant_id, product_name_snapshot/);
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
