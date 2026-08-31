import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const source = async (path) => readFile(new URL(path, import.meta.url), "utf8");

async function findBackOfficePages(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findBackOfficePages(entryPath);
    return entry.isFile() && entry.name === "page.tsx" ? [entryPath] : [];
  }));
  return nested.flat();
}

const [
  checkoutAction,
  checkoutService,
  checkoutRoute,
  authDal,
  backOfficeStoreScope,
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
  posPage,
  posData,
  ticketActions,
  posTerminal,
  posDrawer,
  posCatalogRoute,
  posModifiersRoute,
  posCustomersRoute,
  posCustomerDisplayRoute,
  offlineCheckoutRoute,
  reportsExportRoute,
  catalogExportRoute,
  customersExportRoute,
  suppliersExportRoute,
  organizationExportRoute,
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
  source("../src/lib/auth/dal.ts"),
  source("../src/lib/server/back-office-store-scope.ts"),
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
  source("../src/app/(pos)/pos/page.tsx"),
  source("../src/features/pos/data.ts"),
  source("../src/features/advanced-sales/ticket-actions.ts"),
  source("../src/features/pos/pos-terminal.tsx"),
  source("../src/features/pos/pos-operational-drawer.tsx"),
  source("../src/app/api/pos/catalog/route.ts"),
  source("../src/app/api/pos/modifiers/route.ts"),
  source("../src/app/api/pos/customers/route.ts"),
  source("../src/app/api/pos/customer-display/route.ts"),
  source("../src/app/api/pos/offline-checkout/route.ts"),
  source("../src/app/api/reports/export/route.ts"),
  source("../src/app/api/catalog/export/route.ts"),
  source("../src/app/api/customers/export/route.ts"),
  source("../src/app/api/inventory/suppliers/export/route.ts"),
  source("../src/app/api/organization-export/route.ts"),
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

test("checkout keeps session-derived organization scope and capability-derived store validation on every entry point", () => {
  assert.match(checkoutAction, /requireBusinessContext\(\)/);
  assert.match(checkoutRoute, /getBusinessContext\(\)/);
  assert.match(checkoutRoute, /completeCheckout\(context, input\)/);
  assert.match(checkoutService, /context\.storeIds\.includes\(parsed\.storeId\)/);
  assert.match(checkoutService, /target_organization_id: context\.organization\.id/);
  assert.match(checkoutService, /\.rpc\("checkout_advanced_sale"/);
  assert.match(checkoutService, /hasPermission\(context, "pos\.access"/);
  assert.match(checkoutService, /hasPermission\(context, "payments\.accept"/);
  assert.match(checkoutService, /data\.discountId && !hasPermission\(context, "discounts\.apply"/);
  assert.match(checkoutService, /data\.openTicketId && !hasPermission\(context, "tickets\.manage"/);
  assert.match(authDal, /export function hasOrganizationWideStoreScope/);
  assert.match(authDal, /context\.permissions\.includes\("stores\.manage"\)/);
  assert.match(authDal, /\.from\("stores"\)/);
  assert.match(authDal, /storeIds = \[\.\.\.new Set\(\(organizationStores \?\? \[\]\)\.map/);
  assert.match(backOfficeStoreScope, /hasOrganizationWideStoreScope\(context\)/);
});

test("POS capability gates are enforced consistently in the UI, server actions, and API routes", () => {
  assert.match(posPage, /hasPermission\(context, "pos\.access"/);
  assert.match(posPage, /hasPermission\(context, "sales\.create"/);
  assert.match(posPage, /hasPermission\(context, "payments\.accept"/);
  assert.match(posPage, /hasPermission\(context, "discounts\.apply"/);
  assert.match(posPage, /hasPermission\(context, "tickets\.manage"/);
  assert.match(posData, /hasPermission\(context, "tickets\.manage"/);
  assert.match(ticketActions, /hasPermission\(context, "pos\.access"/);
  assert.match(ticketActions, /hasPermission\(context, "tickets\.manage"/);
  assert.match(posTerminal, /canApplyDiscounts/);
  assert.match(posTerminal, /canEditQuantity/);
  assert.match(posTerminal, /canRemoveItems/);
  assert.match(posDrawer, /canCreateSales/);
  assert.match(posDrawer, /canViewReceipts/);
  assert.match(posDrawer, /canUseShiftControls/);

  for (const [name, content] of [
    ["catalog", posCatalogRoute],
    ["modifier", posModifiersRoute],
    ["customer", posCustomersRoute],
    ["customer display", posCustomerDisplayRoute],
  ]) {
    assert.match(content, /hasPermission\(context, "pos\.access"/, `${name} API requires POS access`);
    assert.match(content, /hasPermission\(context, "sales\.create"/, `${name} API requires sales authority`);
  }
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

test("every authenticated export and offline API has its capability or service authorization boundary", () => {
  assert.match(offlineCheckoutRoute, /getBusinessContext\(\)/);
  assert.match(offlineCheckoutRoute, /completeCheckout\(context, input, \{ guardOfflineTotal: true \}\)/);

  for (const [name, content, capability] of [
    ["report export", reportsExportRoute, "reports.view"],
    ["catalog export", catalogExportRoute, "products.manage"],
    ["customer export", customersExportRoute, "customers.manage"],
    ["supplier export", suppliersExportRoute, "inventory.manage"],
  ]) {
    assert.match(content, /getBusinessContext\(\)/, `${name} resolves the active organization`);
    assert.match(content, new RegExp(`hasPermission\\(context, "${capability.replace(".", "\\.")}"`), `${name} checks ${capability}`);
  }

  assert.match(organizationExportRoute, /getBusinessContext\(\)/);
  assert.match(organizationExportRoute, /context\.tenantReadiness\.canExport/);
  assert.match(organizationExportRoute, /\.rpc\("prepare_organization_export"/);
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

test("every Back Office page declares a server-side authorization boundary", async () => {
  const pages = await findBackOfficePages(
    path.resolve(process.cwd(), "src/app/(back-office)/back-office"),
  );
  assert.ok(pages.length > 0, "Back Office pages were found");

  await Promise.all(pages.map(async (page) => {
    const content = await readFile(page, "utf8");
    assert.match(
      content,
      /requireBackOffice(?:Permission|Context)\(/,
      `${path.relative(process.cwd(), page)} has a server-side authorization boundary`,
    );
  }));
});
