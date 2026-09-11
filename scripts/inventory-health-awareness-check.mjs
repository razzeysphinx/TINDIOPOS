import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [page, health, detail, navigation, migration, clockMigration] = await Promise.all([
  source("../src/app/(back-office)/back-office/inventory/page.tsx"),
  source("../src/features/inventory/inventory-health-workspace.tsx"),
  source("../src/features/inventory/inventory-product-detail.tsx"),
  source("../src/features/inventory/inventory-workspace-navigation.tsx"),
  source("../supabase/migrations/20260905090200_inventory_count_awareness.sql"),
  source("../supabase/migrations/20260905090300_inventory_health_awareness_clock.sql"),
]);

test("Stock health is merged into the attention-first Inventory Overview", () => {
  assert.doesNotMatch(navigation, /\{ id: "health", label:/);
  assert.match(page, /candidate === "health"\) return "overview"/);
  assert.match(page, /<InventoryControlTower/);
  assert.match(page, /<InventoryHealthWorkspace/);
  for (const issue of ["Negative stock", "Low stock", "Out of stock", "Count variance", "Stale physical count", "Never physically counted", "Transfer discrepancy", "Inventory sync conflict"]) {
    assert.match(page, new RegExp(issue));
  }
  assert.match(page, /restockPolicy/);
  assert.match(health, /Multi-store stock/);
  assert.match(health, /Transfers in progress/);
  assert.match(health, /Recent inventory activity/);
  assert.match(health, /This view never changes stock automatically/);
});

test("Phase 2 turns the Overview into a permission-aware owner control tower", () => {
  assert.match(health, /Inventory overview/);
  assert.match(health, /Needs attention/);
  for (const label of ["Active inventory items", "In stock", "Low stock", "Out of stock", "Negative stock", "Incoming transfers", "Incoming purchase orders", "Inventory value"]) {
    assert.match(page, new RegExp(`label: "${label}"`));
  }
  assert.match(health, /Compare the same authorized Stock Levels positions by store/);
  for (const column of ["In stock", "Low", "Out", "Negative", "In transit"]) assert.match(health, new RegExp(`>${column}<`));
  assert.match(page, /const valuationQuery = \["overview", "valuation"\]\.includes\(activeTab\) && canViewCosts/);
  assert.match(page, /openPurchaseOrdersCountQuery\?\.in\("store_id", scopedStoreIds\)/);
  assert.match(page, /const stockPositionCountsByStore = new Map/);
  assert.match(page, /href: stockLevelsHref\(undefined, store\.id\)/);
  assert.match(page, /overviewMetrics=\{overviewMetrics\}/);
});

test("latest count awareness is read-only, permission checked, and store scoped", () => {
  assert.match(migration, /private\.has_permission\(target_organization_id, 'inventory\.view'\)/);
  assert.match(migration, /private\.has_store_read_scope\(target_organization_id, level\.store_id\)/);
  assert.match(migration, /count_document\.status in \('posted', 'completed'\)/);
  assert.match(migration, /count_line\.counted_quantity is not null/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /revoke execute on function private\.get_inventory_count_awareness/);
  assert.doesNotMatch(migration, /insert into|update public|delete from/i);
  assert.match(clockMigration, /now\(\) - interval '30 days'/);
  assert.match(clockMigration, /count_recommended boolean/);
  assert.match(clockMigration, /from private\.get_inventory_count_awareness/);
  assert.doesNotMatch(clockMigration, /insert into|update public|delete from/i);
});

test("product investigation keeps quantities distinct and reuses existing workspaces", () => {
  assert.match(detail, /label="On hand"/);
  assert.match(detail, /label="Incoming purchase orders"/);
  assert.match(detail, /label="Transfer inbound"/);
  assert.match(detail, /label="Transfer outbound"/);
  assert.match(detail, /label="Projected stock"/);
  assert.match(detail, /Last physical count/);
  assert.match(detail, />Start count</);
  assert.match(detail, />Create transfer</);
  assert.match(page, /Math\.max\(0, Number\(line\.ordered_quantity\) - Number\(line\.received_quantity\)\)/);
  assert.match(page, /Math\.max\(0, Number\(line\.quantity\) - Number\(line\.received_quantity\)\)/);
});

test("Phase 4 does not add stock mutation or automatic transfer behavior", () => {
  assert.doesNotMatch(health, /create.*transfer.*action/i);
  assert.doesNotMatch(health, /update.*inventory/i);
  assert.doesNotMatch(migration, /apply_inventory_change|inventory_movements/i);
});

test("Phase 7 surfaces only actionable zero-stock positions", () => {
  assert.match(page, /condition === "out_of_stock" && row\.isAvailable/);
  assert.match(page, /marked Do not restock/);
  assert.match(page, /no replenishment request is suggested/);
});
