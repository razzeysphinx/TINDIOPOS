import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [migration, actions, workflows, schema, sqlTest, concurrency] = await Promise.all([
  read("../supabase/migrations/20260918023953_canonical_purchasing_receiving.sql"),
  read("../src/features/inventory/advanced-inventory-actions.ts"),
  read("../src/features/inventory/advanced-inventory-workflows.tsx"),
  read("../src/features/inventory/advanced-inventory-schema.ts"),
  read("../supabase/tests/database/canonical_purchasing_receiving.test.sql"),
  read("./purchase-order-receipt-concurrency-certification.mjs"),
]);

test("supplier and purchase-order entry points remain canonical and stock-neutral", () => {
  for (const action of ["createSupplierAction", "updateSupplierAction", "importSuppliersCsvAction",
    "createPurchaseOrderAction", "receivePurchaseOrderAction", "cancelPurchaseOrderAction"])
    assert.match(actions, new RegExp(`export async function ${action}`));
  for (const rpc of ["create_supplier", "update_supplier", "import_suppliers_csv",
    "create_purchase_order_v2", "receive_purchase_order", "cancel_purchase_order"])
    assert.match(actions, new RegExp(`rpc\\(\"${rpc}\"`));
  assert.doesNotMatch(actions, /rpc\("create_purchase_order"/);
  assert.doesNotMatch(actions, /from\("inventory_levels"\)\.(?:insert|update|upsert|delete)/);
  assert.match(actions, /createPurchaseOrderAction[\s\S]*products\.view_cost/);
});

test("supplier and PO CSV workflows preserve the canonical server actions", () => {
  assert.match(workflows, /SupplierCsvTools/);
  assert.match(workflows, /function PurchaseOrderCsvTools/);
  assert.match(workflows, /purchase-order-import/);
  assert.match(workflows, /createPurchaseOrderAction\(\{ operationId:/);
  assert.doesNotMatch(workflows, /from\("(?:purchase_orders|inventory_levels)"\)\.(?:insert|update|upsert|delete)/);
  assert.match(schema, /createPurchaseOrderSchema/);
});

test("receipt conversion, cost truth, idempotency, and immutability are machine-guarded", () => {
  assert.match(migration, /base_quantity_received/);
  assert.match(migration, /purchase_unit_factor_to_base/);
  assert.match(migration, /purchase_unit_cost_minor/);
  assert.match(migration, /stock_unit_cost_minor/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /products\.view_cost/);
  assert.match(migration, /Posted goods-receipt evidence is immutable/);
  assert.match(sqlTest, /canonical receipt rejects over-receipt/);
  assert.match(concurrency, /Promise\.all\(/);
  assert.match(concurrency, /successfulCompeting === 1/);
  assert.match(concurrency, /reconcileInventoryState/);
});

test("supplier returns remain an independent post-receipt domain", () => {
  assert.match(actions, /returnToSupplierAction/);
  assert.match(actions, /rpc\("return_to_supplier"/);
  assert.doesNotMatch(migration, /supplier_returns|supplier_return_lines|return_to_supplier/);
});
