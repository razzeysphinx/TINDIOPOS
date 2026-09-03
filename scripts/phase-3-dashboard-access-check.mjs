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
const inventoryPage = await readFile(
  new URL("../src/app/(back-office)/back-office/inventory/page.tsx", import.meta.url),
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

test("business dashboard keeps its server route gate and embeds the reusable action grid", () => {
  assert.match(dashboardPage, /requireBackOfficePermission\("dashboard\.view"\)/);
  assert.match(dashboardPage, /<DashboardActionGrid/);
  assert.match(dashboardPage, /permissions=\{context\.permissions\}/);
  assert.match(dashboardPage, /surface="business"/);
});

test("inventory dashboard reuses the action grid behind its inventory permission gate", () => {
  // View-only inventory users retain the Stock and Activity tabs; management
  // operations remain separately gated by inventory.manage.
  assert.match(inventoryPage, /requireBackOfficePermission\(\["inventory\.view", "inventory\.manage"\]\)/);
  assert.match(inventoryPage, /<DashboardActionGrid/);
  assert.match(inventoryPage, /permissions=\{context\.permissions\}/);
  assert.match(inventoryPage, /surface="inventory"/);
  assert.match(dashboardActions, /\/back-office\/inventory\?tab=(overview|adjustments|purchasing|controls)/);
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
