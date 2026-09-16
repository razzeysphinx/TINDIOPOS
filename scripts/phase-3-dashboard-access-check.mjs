import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardActions = await readFile(
  new URL("../src/features/dashboard/dashboard-action-grid.tsx", import.meta.url),
  "utf8",
);
const dashboardPage = await readFile(
  new URL("../src/app/(back-office)/back-office/page.tsx", import.meta.url),
  "utf8",
);
const ownerDashboard = await readFile(
  new URL("../src/features/dashboard/owner-dashboard.tsx", import.meta.url),
  "utf8",
);
const inventoryPage = await readFile(
  new URL("../src/app/(back-office)/back-office/inventory/page.tsx", import.meta.url),
  "utf8",
);
const inventoryCapabilities = await readFile(
  new URL("../src/lib/auth/inventory-capabilities.ts", import.meta.url),
  "utf8",
);
const posPage = await readFile(
  new URL("../src/app/(pos)/pos/page.tsx", import.meta.url),
  "utf8",
);
const posTerminal = await readFile(
  new URL("../src/features/pos/pos-terminal.tsx", import.meta.url),
  "utf8",
);
const reporting = await readFile(
  new URL("../src/features/reports/reporting.ts", import.meta.url),
  "utf8",
);

test("action widgets are permission-driven rather than role-name-driven", () => {
  assert.match(dashboardActions, /hasPermission\(permissions, "reports\.view"\)/);
  assert.match(dashboardActions, /hasAnyPermission\(permissions, \["employees\.manage", "roles\.manage"\]\)/);
  assert.doesNotMatch(dashboardActions, /roleNames/);
});

test("business dashboard keeps its server route gate and renders the executive control center", () => {
  assert.match(dashboardPage, /requireBackOfficePermission\("dashboard\.view"\)/);
  assert.match(dashboardPage, /<DashboardFilterForm/);
  assert.match(dashboardPage, /<OwnerDashboard/);
  assert.match(dashboardPage, /<Suspense/);
  assert.match(dashboardPage, /const dashboardStateKey = dashboardQueryString\(period, selectedStoreId\)/);
  assert.match(dashboardPage, /key=\{`filters:\$\{dashboardStateKey\}`\}/);
  assert.match(dashboardPage, /key=\{`sections:\$\{dashboardStateKey\}`\}/);
  assert.doesNotMatch(dashboardPage, /<DashboardActionGrid/);
  assert.match(ownerDashboard, /title="Executive snapshot"/);
  assert.match(ownerDashboard, /label="Transactions"/);
  assert.doesNotMatch(ownerDashboard, /label="Completed sales"/);
});

test("inventory workspace uses the current granular inventory responsibility gate", () => {
  assert.match(inventoryPage, /const context = await requireBackOfficeContext\(\);/);
  assert.match(inventoryPage, /!hasInventoryBackOfficeResponsibility\(\s*context\.permissions,\s*\)/);
  assert.match(inventoryPage, /redirect\(getBackOfficeHome\(context\)\)/);
  assert.doesNotMatch(
    inventoryPage,
    /requireBackOfficePermission\(\s*\[\s*"inventory\.view"/,
    "the retired fixed inventory permission list must not return",
  );
  assert.match(inventoryCapabilities, /export function hasInventoryBackOfficeResponsibility\(/);
  assert.match(inventoryCapabilities, /hasInventoryControlResponsibility\(permissions\)/);
  assert.match(inventoryCapabilities, /hasPurchasingResponsibility\(permissions\)/);
  assert.match(inventoryPage, /<DashboardActionGrid/);
  assert.match(inventoryPage, /permissions=\{context\.permissions\}/);
  assert.match(inventoryPage, /surface="inventory"/);
  for (const href of [
    "/back-office/inventory?tab=overview",
    "/back-office/inventory?tab=stock",
    "/back-office/inventory?tab=activity",
    "/back-office/inventory?tab=counts",
    "/back-office/purchasing?tab=purchase-orders",
    "/back-office/inventory?tab=transfers",
  ]) {
    assert.ok(
      dashboardActions.includes(`href: "${href}"`),
      `inventory action grid must retain ${href}`,
    );
  }
});

test("reporting remains server-scoped through the established dashboard RPC", () => {
  assert.match(reporting, /get_dashboard_snapshot/);
  assert.match(reporting, /hasOrganizationReportingScope/);
});

test("cashier POS remains a sales-permission route with its existing shift gate", () => {
  assert.match(posPage, /hasPermission\(context, "sales\.create"\)/);
  assert.match(posPage, /redirect\(getWorkspaceHome\(context\)\)/);
  assert.match(posTerminal, /PosShiftGate/);
});
