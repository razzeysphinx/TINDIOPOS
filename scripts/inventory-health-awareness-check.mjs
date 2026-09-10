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

test("Phase 4 adds an attention-first control tower and Stock Health workspace", () => {
  assert.match(navigation, /"health"/);
  assert.match(navigation, /Stock Health/);
  assert.match(page, /<InventoryControlTower/);
  assert.match(page, /<InventoryHealthWorkspace/);
  for (const issue of ["Negative stock", "Low stock", "Out of stock", "Count variance", "Stale physical count", "Never physically counted", "Transfer discrepancy", "Inventory sync conflict"]) {
    assert.match(page, new RegExp(issue));
  }
  assert.match(page, /restockPolicy/);
  assert.match(health, /Multi-store stock/);
  assert.match(health, /Transfers in progress/);
  assert.match(health, /Recent inventory activity/);
  assert.match(health, /This page never changes stock automatically/);
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
  assert.match(detail, /label="Incoming"/);
  assert.match(detail, /label="In transit"/);
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
