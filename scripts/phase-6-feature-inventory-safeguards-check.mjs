import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardPage = await readFile(
  new URL("../src/app/(back-office)/back-office/page.tsx", import.meta.url),
  "utf8",
);
const reportingOverview = await readFile(
  new URL("../src/features/reports/reporting-overview.tsx", import.meta.url),
  "utf8",
);
const businessProfile = await readFile(
  new URL("../src/features/business-profile/business-profile-manager.tsx", import.meta.url),
  "utf8",
);
const businessProfileService = await readFile(
  new URL("../src/features/business-profile/service.ts", import.meta.url),
  "utf8",
);
const inventoryActions = await readFile(
  new URL("../src/features/inventory/advanced-inventory-actions.ts", import.meta.url),
  "utf8",
);
const inventoryMigration = await readFile(
  new URL("../supabase/migrations/20260824170000_improvement_9_inventory_integrity_workflows.sql", import.meta.url),
  "utf8",
);

test("feature settings remain complete, permission-gated, and explicitly preserve records", () => {
  assert.match(businessProfile, /featureDefinitions\.map/);
  assert.match(businessProfile, /Existing records remain intact/);
  assert.match(businessProfileService, /update_business_profile_features/);
  assert.match(businessProfileService, /isCompleteFeatureSettings/);
});

test("dashboard inventory alerts reuse the existing scoped report snapshot", () => {
  assert.match(dashboardPage, /inventoryEnabled=\{context\.features\.inventory\}/);
  assert.match(reportingOverview, /mode === "dashboard" && inventoryEnabled/);
  assert.match(reportingOverview, /Inventory alerts/);
  assert.match(reportingOverview, /snapshot\.inventory\.low_stock_count/);
  assert.match(reportingOverview, /snapshot\.inventory\.negative_stock_count/);
});

test("negative-stock safeguards retain allow, warn, and block policies through the established RPC", () => {
  assert.match(inventoryActions, /updateInventoryPolicySchema\.safeParse/);
  assert.match(inventoryActions, /\.rpc\("update_inventory_policy"/);
  assert.match(inventoryMigration, /\('allow', 'warn', 'block'\)/);
  assert.match(inventoryMigration, /enforce_negative_stock_policy/);
  assert.match(inventoryMigration, /INVENTORY_POLICY_UPDATED/);
});

test("Phase 6 does not introduce a migration or a frontend authorization substitute", () => {
  assert.doesNotMatch(reportingOverview, /roleNames/);
  assert.doesNotMatch(reportingOverview, /supabase\.from\(/);
  assert.match(inventoryActions, /hasPermission\(context, "inventory\.manage"\)/);
});
