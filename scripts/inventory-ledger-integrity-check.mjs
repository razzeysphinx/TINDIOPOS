import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [migration, databaseTest] = await Promise.all([
  source("../supabase/migrations/20260906062727_inventory_ledger_integrity_metadata.sql"),
  source("../supabase/tests/database/inventory_ledger_integrity.test.sql"),
]);

test("inventory movements capture immutable unit and operation metadata", () => {
  assert.match(migration, /add column if not exists unit_snapshot text/);
  assert.match(migration, /add column if not exists operation_id uuid/);
  assert.match(migration, /set operation_id = coalesce\(movement\.source_id, movement\.id\)/);
  assert.match(migration, /alter column unit_snapshot set not null/);
  assert.match(migration, /alter column operation_id set not null/);
  assert.match(migration, /new\.operation_id := coalesce\(new\.operation_id, new\.source_id, new\.id\)/);
});

test("the database rejects non-inventory movements and historical movement edits", () => {
  assert.match(migration, /and product\.track_inventory/);
  assert.match(migration, /Inventory movements require an inventory-tracked product/);
  assert.match(migration, /before update or delete on public\.inventory_movements/);
  assert.match(migration, /Inventory movements are append-only/);
});

test("ledger source and operation lookups remain index-backed and database-tested", () => {
  assert.match(migration, /inventory_movements_source_lookup_idx/);
  assert.match(migration, /inventory_movements_operation_lookup_idx/);
  assert.match(databaseTest, /returning unit_snapshot, operation_id into posted_unit, posted_operation/);
  assert.match(databaseTest, /perform private\.apply_inventory_change_v2/);
  assert.match(databaseTest, /ROLLBACK_PHASE_1_CANONICAL_TEST/);
  assert.match(databaseTest, /ROLLBACK_PHASE_1_LEDGER_TEST/);
  assert.match(databaseTest, /Phase 1 append-only guard did not reject the update/);
});
