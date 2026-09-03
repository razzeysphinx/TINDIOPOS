import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

const [terminal, warning, service, settings, migration] = await Promise.all([
  source("src/features/pos/pos-terminal.tsx"),
  source("src/features/checkout/negative-stock-warning.tsx"),
  source("src/features/checkout/checkout-service.ts"),
  source("src/features/inventory/inventory-integrity-workflows.tsx"),
  source("supabase/migrations/20260903084457_pos_negative_stock_preflight.sql"),
]);

test("Charge performs a fresh server-side stock check before payment", () => {
  assert.match(terminal, /validatePosCartStockAction/);
  assert.match(terminal, /startStockValidationTransition/);
  assert.match(terminal, /result\.policy !== "allow"/);
  assert.match(terminal, /setIsPaymentScreenOpen\(true\)/);
  assert.match(service, /validate_pos_cart_stock/);
  assert.match(service, /target_sale_id: result\.sale_id/);
  assert.match(migration, /private\.require_pos_capabilities/);
  assert.match(migration, /shift\.status = 'open'/);
  assert.match(migration, /available_quantity - tracked\.cart_quantity < 0/);
  assert.match(migration, /product\.track_inventory/);
  assert.match(migration, /item\.sale_id = target_sale_id/);
});

test("warn and block remain distinct without an approval workflow", () => {
  assert.match(warning, /Review cart/);
  assert.match(warning, /Proceed anyway/);
  assert.match(warning, /isBlocked \? "Stock check" : "Stock warning"/);
  assert.doesNotMatch(warning, /manager|approval|PIN|reason dropdown/i);
  assert.match(terminal, /stockDecision\.policy/);
});

test("cart warnings are consolidated and settings reuse the three existing values", () => {
  assert.match(terminal, /Insufficient recorded stock/);
  assert.match(warning, /items\.map/);
  assert.match(settings, /value="block">Block the sale/);
  assert.match(settings, /value="warn">Warn cashier, but allow sale/);
  assert.match(settings, /value="allow">Allow sale without warning/);
  assert.match(migration, /inventory_policies/);
  assert.doesNotMatch(migration, /negative_stock_policy_v2|pos_stock_warning_mode|new_negative_policy/);
});
