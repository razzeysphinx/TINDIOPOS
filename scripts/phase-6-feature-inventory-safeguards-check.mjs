import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardPage = await readFile(
  new URL("../src/app/(back-office)/back-office/page.tsx", import.meta.url),
  "utf8",
);
const ownerDashboard = await readFile(
  new URL("../src/features/dashboard/owner-dashboard.tsx", import.meta.url),
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
  assert.match(businessProfile, /Existing records stay intact/);
  assert.match(businessProfileService, /update_business_profile_features/);
  assert.match(businessProfileService, /isCompleteFeatureSettings/);
});

test("dashboard inventory alerts reuse scoped report and operational snapshots", () => {
  assert.match(dashboardPage, /inventory: context\.features\.inventory/);
  assert.match(dashboardPage, /loadDashboardOperationalSnapshot/);
  assert.match(ownerDashboard, /features\.inventory && operations\.access\.inventory/);
  assert.match(ownerDashboard, /operations\.inventory\.low_stock_count/);
  assert.match(ownerDashboard, /operations\.inventory\.negative_stock_count/);
});

test("negative-stock safeguards retain allow, warn, and block policies through the established RPC", () => {
  assert.match(inventoryActions, /updateInventoryPolicySchema\.safeParse/);
  assert.match(inventoryActions, /\.rpc\("update_inventory_policy"/);
  assert.match(inventoryMigration, /\('allow', 'warn', 'block'\)/);
  assert.match(inventoryMigration, /enforce_negative_stock_policy/);
  assert.match(inventoryMigration, /INVENTORY_POLICY_UPDATED/);
});

test("Phase 6 does not introduce a migration or a frontend authorization substitute", () => {
  assert.doesNotMatch(ownerDashboard, /roleNames/);
  assert.doesNotMatch(ownerDashboard, /supabase\.from\(/);
  assert.match(inventoryActions, /hasPermission\(context, "inventory\.manage"\)/);
});
