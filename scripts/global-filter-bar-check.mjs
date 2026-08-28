import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const filterBar = await readFile(
  new URL("../src/components/back-office/global-filter-bar.tsx", import.meta.url),
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
const reportsPage = await readFile(
  new URL("../src/app/(back-office)/back-office/reports/page.tsx", import.meta.url),
  "utf8",
);

test("global filter bar provides responsive date, store, and apply controls", () => {
  assert.match(filterBar, /showDateRange/);
  assert.match(filterBar, /showStore/);
  assert.match(filterBar, />From date</);
  assert.match(filterBar, />To date</);
  assert.match(filterBar, />Store</);
  assert.match(filterBar, />\s*Apply\s*<\/Button>/);
  assert.match(filterBar, /name="start"/);
  assert.match(filterBar, /name="end"/);
  assert.match(filterBar, /name="store"/);
  assert.match(filterBar, /method="get"/);
  assert.match(filterBar, /sm:grid-cols-2 lg:flex/);
});

test("reports reuse the global filter bar and retain the established export query", () => {
  assert.match(reportFilter, /<GlobalFilterBar/);
  assert.match(reportFilter, /fromDate=\{filter\.startDate\}/);
  assert.match(reportFilter, /toDate=\{filter\.endDate\}/);
  assert.match(reportFilter, /storeId=\{filter\.storeId\}/);
  assert.match(reportFilter, /\/api\/reports\/export\?\$\{exportQuery\}&kind=\$\{kind\}/);
  assert.doesNotMatch(reportFilter, /<form/);
});

test("dashboard and reports place the shared filter directly after their page header", () => {
  assert.ok(
    dashboardPage.indexOf("<ReportFilterForm") > dashboardPage.indexOf("<PageHeader"),
    "dashboard filter must follow its page header",
  );
  assert.ok(
    dashboardPage.indexOf("<ReportFilterForm") < dashboardPage.indexOf("<DashboardActionGrid"),
    "dashboard filter must precede dashboard content",
  );
  assert.ok(
    reportsPage.indexOf("<ReportFilterForm") > reportsPage.indexOf("<PageHeader"),
    "reports filter must follow its page header",
  );
});
