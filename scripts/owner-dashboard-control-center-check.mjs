import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/app/(back-office)/back-office/page.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../src/features/dashboard/owner-dashboard.tsx", import.meta.url), "utf8");
const period = await readFile(new URL("../src/features/dashboard/dashboard-period.ts", import.meta.url), "utf8");
const attention = await readFile(new URL("../src/features/dashboard/needs-attention.tsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260903090000_owner_dashboard_control_center.sql", import.meta.url), "utf8");

test("owner dashboard follows the executive-first hierarchy", () => {
  const headings = [
    'title="Executive snapshot"',
    "<NeedsAttention",
    "Sales performance",
    "Store performance",
    "Today’s operations",
    "Inventory health",
    "Top products",
    "Payment mix",
    "Team & customers",
    'title="Quick actions"',
  ];
  for (let index = 1; index < headings.length; index += 1) {
    assert.ok(dashboard.indexOf(headings[index - 1]) < dashboard.indexOf(headings[index]), `${headings[index - 1]} must precede ${headings[index]}`);
  }
  assert.doesNotMatch(page, /What would you like to do/);
  assert.doesNotMatch(page, /<ReportingOverview/);
});

test("dashboard comparisons, custom periods, and honest unknown states are explicit", () => {
  assert.match(period, /"today"/);
  assert.match(period, /"previous_month"/);
  assert.match(period, /comparisonFilter/);
  assert.match(dashboard, /Cost data incomplete/);
  assert.match(dashboard, /missing_sales_cost_item_count/);
  assert.match(dashboard, /missing_inventory_cost_count/);
  assert.match(dashboard, /No sales yet/);
  assert.match(dashboard, /No tracked inventory yet/);
  assert.match(page, /<DashboardSetup setupItemsPromise=\{setupItemsPromise\}/);
  assert.ok(
    page.indexOf("<DashboardSections") < page.indexOf("<DashboardSetup"),
    "supplemental onboarding queries must not block the executive dashboard boundary",
  );
});

test("attention is severity-ranked without relying only on color", () => {
  assert.match(attention, /"critical" \| "needs_attention" \| "watch"/);
  assert.match(attention, /\? "Critical"/);
  assert.match(attention, /\? "Needs attention"/);
  assert.match(attention, /: "Watch"/);
  assert.match(dashboard, /pending_approval_count/);
  assert.match(dashboard, /sync_issue_count/);
  assert.match(dashboard, /features\.deviceManagement && operations\.access\.devices/);
  assert.match(dashboard, /features\.timeClock && operations\.access\.team/);
  assert.match(dashboard, /features\.shifts && operations\.access\.shifts/);
});

test("database supplement enforces scope, permission gates, and disjoint stock conditions", () => {
  assert.match(migration, /private\.has_permission\(target_organization_id, 'dashboard\.view'\)/);
  assert.match(migration, /Dashboard data is limited to an assigned store/);
  assert.match(migration, /position\.quantity > 0/);
  assert.match(migration, /position\.quantity = 0/);
  assert.match(migration, /position\.quantity < 0/);
  assert.match(migration, /request\.status = 'PENDING'/);
  assert.match(migration, /request\.expires_at > now\(\)/);
  assert.match(migration, /row\.sales_minor - row\.refunds_minor/);
  assert.match(migration, /if not can_inventory then/);
});
