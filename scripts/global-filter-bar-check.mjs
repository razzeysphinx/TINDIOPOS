import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const filterBar = await readFile(
  new URL("../src/components/back-office/global-filter-bar.tsx", import.meta.url),
  "utf8",
);
const dateRangePicker = await readFile(
  new URL("../src/components/back-office/date-range-picker.tsx", import.meta.url),
  "utf8",
);
const filterNavigation = await readFile(
  new URL("../src/components/back-office/back-office-filter-navigation.ts", import.meta.url),
  "utf8",
);
const reportFilter = await readFile(
  new URL("../src/features/reports/report-filter-form.tsx", import.meta.url),
  "utf8",
);
const dashboardPage = await readFile(
  new URL("../src/app/(back-office)/back-office/page.tsx", import.meta.url),
  "utf8",
);
const dashboardFilter = await readFile(
  new URL("../src/features/dashboard/dashboard-filter-form.tsx", import.meta.url),
  "utf8",
);
const reportsPage = await readFile(
  new URL("../src/app/(back-office)/back-office/reports/page.tsx", import.meta.url),
  "utf8",
);
const inventoryPage = await readFile(
  new URL("../src/app/(back-office)/back-office/inventory/page.tsx", import.meta.url),
  "utf8",
);

test("global filter bar provides one responsive date-range control and instant URL updates", () => {
  assert.match(filterBar, /showDateRange/);
  assert.match(filterBar, /showStore/);
  assert.match(filterBar, /<DateRangePicker/);
  assert.match(filterBar, /startName=\{dateStartName\}/);
  assert.match(filterBar, /endName=\{dateEndName\}/);
  assert.match(filterBar, />Store</);
  assert.match(filterBar, /name="store"/);
  assert.match(filterBar, /method="get"/);
  assert.match(filterBar, /onChange=\{handleFieldChange\}/);
  assert.doesNotMatch(filterBar, />\s*Apply\s*<\/Button>/);
  assert.match(filterBar, /sm:grid-cols-2 lg:flex/);
});

test("the shared date picker owns presets, drafts custom selection, and uses date-only values", () => {
  for (const label of ["Today", "Yesterday", "This week", "Last week", "This month", "Last month", "Last 7 days", "Last 30 days"]) {
    assert.match(dateRangePicker, new RegExp(`label: "${label}"`));
  }
  assert.match(dateRangePicker, /Choose a start date, then an end date/);
  assert.match(dateRangePicker, />Custom<\/Button>/);
  assert.match(dateRangePicker, /onClick=\{commitCustomRange\}/);
  assert.match(dateRangePicker, /onClick=\{clearRange\}/);
  assert.match(dateRangePicker, /value < draftRange\.start/);
  assert.match(dateRangePicker, /new Date\(year, month - 1, day\)/);
  assert.doesNotMatch(dateRangePicker, /toISOString\(/);
  assert.match(dateRangePicker, /Popover\.Root/);
});

test("shared navigation retains query-driven server filtering and resets only cursor pagination", () => {
  assert.match(filterNavigation, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(filterNavigation, /current\.delete\("before"\)/);
  assert.match(filterNavigation, /router\.replace/);
  assert.match(filterNavigation, /scroll: false/);
});

test("reports reuse the global filter bar and retain the established export query", () => {
  assert.match(reportFilter, /<GlobalFilterBar/);
  assert.match(reportFilter, /fromDate=\{filter\.startDate\}/);
  assert.match(reportFilter, /toDate=\{filter\.endDate\}/);
  assert.match(reportFilter, /timezone=\{timezone\}/);
  assert.match(reportFilter, /storeId=\{filter\.storeId\}/);
  assert.match(reportFilter, /<ReportExportActions exportQuery=\{exportQuery\}/);
  assert.doesNotMatch(reportFilter, /<form/);
});

test("dashboard keeps its period presets and delegates Custom to the shared date-range picker", () => {
  assert.ok(
    dashboardPage.indexOf("<DashboardFilterForm") > dashboardPage.indexOf("<PageHeader"),
    "dashboard filter must follow its page header",
  );
  assert.ok(
    dashboardPage.indexOf("<DashboardFilterForm") < dashboardPage.indexOf("<Suspense"),
    "dashboard filter must precede dashboard content",
  );
  assert.match(dashboardFilter, /name="period"/);
  assert.match(dashboardFilter, /value="today"/);
  assert.match(dashboardFilter, /value="last_7_days"/);
  assert.match(dashboardFilter, /value="custom"/);
  assert.match(dashboardFilter, /selectedPeriod === "custom"/);
  assert.match(dashboardFilter, /<DateRangePicker/);
  assert.match(dashboardFilter, /period: "custom"/);
  assert.doesNotMatch(dashboardFilter, />Apply<\/Button>/);
  assert.match(dashboardFilter, /name="compare"/);
  assert.ok(
    reportsPage.indexOf("<ReportFilterForm") > reportsPage.indexOf("<PageHeader"),
    "reports filter must follow its page header",
  );
});

test("inventory activity reuses the date range picker contract and includes its end date", () => {
  assert.match(inventoryPage, /<GlobalFilterBar/);
  assert.match(inventoryPage, /dateStartName="from"/);
  assert.match(inventoryPage, /dateEndName="to"/);
  assert.match(inventoryPage, /recentMovementsQuery\?\.lte\("created_at", `\$\{activityTo\}T23:59:59\.999Z`\)/);
  assert.doesNotMatch(inventoryPage, /<span>From<\/span><input/);
  assert.doesNotMatch(inventoryPage, /<span>To<\/span><input/);
});
