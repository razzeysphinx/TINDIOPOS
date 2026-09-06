import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

const [page, navigation, sections, overview, filterForm, exportsRoute, exportActions, reporting] = await Promise.all([
  source("src/app/(back-office)/back-office/reports/page.tsx"),
  source("src/features/reports/business-reports-navigation.tsx"),
  source("src/features/reports/report-sections.ts"),
  source("src/features/reports/reporting-overview.tsx"),
  source("src/features/reports/report-filter-form.tsx"),
  source("src/app/api/reports/export/route.ts"),
  source("src/features/reports/report-export-actions.tsx"),
  source("src/features/reports/reporting.ts"),
]);

test("Business Reports keeps the two-item Reports sidebar and uses internal sections", () => {
  assert.match(page, /title="Business Reports"/);
  assert.match(page, /<BusinessReportsNavigation/);
  assert.match(navigation, /Business report sections/);
  for (const section of ["overview", "sales", "products", "inventory", "operations", "team-customers", "security-accountability"]) {
    assert.match(sections, new RegExp(`"${section}"`));
  }
});

test("the selected section is the only report detail tree rendered", () => {
  assert.match(overview, /mode === "reports" && section \? <BusinessReportDetails/);
  assert.match(overview, /if \(section === "overview"\)/);
  assert.match(overview, /if \(section === "sales"\)/);
  assert.match(overview, /if \(section === "products"\)/);
  assert.match(overview, /if \(section === "inventory"\)/);
  assert.match(overview, /if \(section === "operations"\)/);
  assert.match(overview, /if \(section === "team-customers"\)/);
  assert.match(overview, /Security & Accountability/);
});

test("date and store filtering persists through sections, print, and section-aware exports", () => {
  assert.match(page, /filterQuery=\{reportQueryString\(filter\)\}/);
  assert.match(filterForm, /hiddenFields=\{section \? \{ section \} : undefined\}/);
  assert.match(filterForm, /<ReportExportActions exportQuery=\{exportQuery\} section=\{section\}/);
  assert.match(overview, /section=\{section\}/);
  assert.match(exportActions, /sectionExportIds/);
  assert.match(exportActions, /section = "overview"/);
  assert.match(exportsRoute, /"products"/);
  assert.match(exportsRoute, /case "products"/);
});

test("the existing scoped snapshot remains the sole calculation and authorization path", () => {
  assert.match(page, /getReportingSnapshot\(context, filter, "reports"\)/);
  assert.match(reporting, /hasOrganizationReportingScope/);
  assert.match(reporting, /resolveBackOfficeStoreScope/);
  assert.match(reporting, /get_reports_snapshot/);
  assert.doesNotMatch(page, /from\("sales"\)/);
});
