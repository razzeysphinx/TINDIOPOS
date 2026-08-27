import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  checkoutAction,
  checkoutService,
  checkoutRoute,
  receiptActions,
  shiftActions,
  inventoryActions,
  catalogActions,
  catalogService,
  managementActions,
  paymentActions,
  businessProfileActions,
  deviceActions,
  deviceRoute,
  advancedSalesActions,
  taxBoundaryTest,
  checkoutTest,
  refundTest,
  shiftTest,
  inventoryTest,
  deviceTest,
  paymentTest,
  featureTest,
  rlsTest,
] = await Promise.all([
  source("../src/features/checkout/actions.ts"),
  source("../src/features/checkout/checkout-service.ts"),
  source("../src/app/api/pos/checkout/route.ts"),
  source("../src/features/receipts/actions.ts"),
  source("../src/features/shifts/actions.ts"),
  source("../src/features/inventory/advanced-inventory-actions.ts"),
  source("../src/features/catalog/actions.ts"),
  source("../src/features/catalog/service.ts"),
  source("../src/features/management/actions.ts"),
  source("../src/features/payments/actions.ts"),
  source("../src/features/business-profile/actions.ts"),
  source("../src/features/devices/actions.ts"),
  source("../src/app/api/pos/device/route.ts"),
  source("../src/features/advanced-sales/actions.ts"),
  source("../supabase/tests/database/phase_7_security_boundary_hardening.test.sql"),
  source("../supabase/tests/database/phase_4_cash_checkout.test.sql"),
  source("../supabase/tests/database/phase_5_receipts_refunds.test.sql"),
  source("../supabase/tests/database/phase_6_register_shifts.test.sql"),
  source("../supabase/tests/database/phase_2_rls.test.sql"),
  source("../supabase/tests/database/improvement_12_device_register_management.test.sql"),
  source("../supabase/tests/database/improvement_5_payment_configuration.test.sql"),
  source("../supabase/tests/database/improvement_11_business_profile_features.test.sql"),
  source("../supabase/tests/database/phase_1_rls.test.sql"),
]);

test("checkout keeps session-derived organization scope and assigned-store validation on every entry point", () => {
  assert.match(checkoutAction, /requireBusinessContext\(\)/);
  assert.match(checkoutRoute, /getBusinessContext\(\)/);
  assert.match(checkoutRoute, /completeCheckout\(context, input\)/);
  assert.match(checkoutService, /context\.storeIds\.includes\(parsed\.storeId\)/);
  assert.match(checkoutService, /target_organization_id: context\.organization\.id/);
  assert.match(checkoutService, /\.rpc\("checkout_advanced_sale"/);
});

test("sensitive server actions require a business context and their established permission boundary", () => {
  for (const [name, content, permission] of [
    ["refund", receiptActions, "sales.refund"],
    ["cash movement and shift close", shiftActions, "shifts.close"],
    ["inventory adjustment", inventoryActions, "inventory.manage"],
    ["catalog price override", catalogActions, "products.manage"],
    ["role management", managementActions, "roles.manage"],
    ["employee management", managementActions, "employees.manage"],
    ["store management", managementActions, "stores.manage"],
    ["payment configuration", paymentActions, "settings.manage"],
    ["feature settings", businessProfileActions, "settings.manage"],
    ["device operations", deviceActions, "devices.manage"],
    ["discount and tax settings", advancedSalesActions, "products.manage"],
  ]) {
    assert.match(content, /requireBusinessContext\(\)/, `${name} requires an authenticated workspace`);
    assert.match(content, new RegExp(`hasPermission\\(context, "${permission.replace(".", "\\.")}"`, "i"), `${name} checks ${permission}`);
  }

  assert.match(inventoryActions, /\.rpc\("record_inventory_adjustment_v2"/);
  assert.match(catalogService, /price_override_minor/);
  assert.match(catalogService, /organization_id: context\.organization\.id/);
});

test("device validation rejects a caller-supplied organization that differs from the active workspace", () => {
  assert.match(deviceRoute, /input\.data\.organizationId !== context\.organization\.id/);
  assert.match(deviceRoute, /target_organization_id: context\.organization\.id/);
  assert.match(deviceRoute, /\.rpc\("validate_pos_device"/);
});

test("the database attack suite covers every Phase 7 negative path", () => {
  assert.match(rlsTest, /an admin cannot assign a role containing permissions they do not hold/);
  assert.match(taxBoundaryTest, /cashier administrative role changes are rejected by RLS/);
  assert.match(rlsTest, /cross-organization inserts are rejected/);
  assert.match(checkoutTest, /another organization cannot charge this store/);
  assert.match(checkoutTest, /cashier cannot insert sales outside the checkout routine/);
  assert.match(refundTest, /cashiers without sales\.refund cannot process refunds/);
  assert.match(shiftTest, /direct checkout is rejected after the current shift closes/);
  assert.match(inventoryTest, /cashier cannot adjust inventory/);
  assert.match(deviceTest, /a revoked device credential is rejected/);
  assert.match(paymentTest, /a cashier cannot reconfigure payment methods/);
  assert.match(featureTest, /an unrelated user cannot update business features/);
  assert.match(taxBoundaryTest, /cashier tax-rate changes are rejected by RLS/);
});
