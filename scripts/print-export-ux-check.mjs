import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [filterForm, actions, overview, reportsPage, exportRoute, inventoryStockView, printCss] = await Promise.all([
  source("../src/features/reports/report-filter-form.tsx"),
  source("../src/features/reports/report-export-actions.tsx"),
  source("../src/features/reports/reporting-overview.tsx"),
  source("../src/app/(back-office)/back-office/reports/page.tsx"),
  source("../src/app/api/reports/export/route.ts"),
  source("../src/features/inventory/inventory-stock-view.tsx"),
  source("../src/app/globals.css"),
]);

test("the report filter replaces visible CSV links with the shared action menus", () => {
  assert.match(filterForm, /<ReportExportActions exportQuery=\{exportQuery\}/);
  assert.doesNotMatch(filterForm, /Sales CSV/);
  assert.doesNotMatch(filterForm, /<Link/);
});

test("the CSV menu reuses the canonical export route and keeps each action independent", () => {
  assert.match(actions, /fetch\(`\/api\/reports\/export\?\$\{exportQuery\}&kind=\$\{item\.id\}`/);
  assert.match(actions, /setBusyAction\(item\.id\)/);
  assert.match(actions, /disabled=\{isBusy\}/);
  assert.match(actions, /We couldn't export this CSV\. Your report filters are unchanged\./);
  assert.match(actions, /Security \/ audit log/);
  assert.match(exportRoute, /hasAuthorizedReportStoreSelection/);
  assert.match(exportRoute, /hasPermission\(context, "reports\.view"\)/);
});

test("print uses only the active report snapshot and the browser print dialog", () => {
  assert.match(actions, /document\.body\.dataset\.printMode = "report"/);
  assert.match(actions, /window\.print\(\)/);
  assert.match(actions, /Save as PDF/);
  assert.doesNotMatch(actions, /Download PDF/);
  assert.match(overview, /data-report-print-document/);
  assert.match(overview, /Store scope/);
  assert.match(overview, /Date range/);
  assert.match(overview, /snapshot\.sales_by_store/);
  assert.match(reportsPage, /printContext=\{\{/);
  assert.match(printCss, /body\[data-print-mode="report"\] \[data-report-screen\]/);
  assert.match(printCss, /display: table-header-group/);
});

test("inventory prints the current authorized stock view without creating an export route", () => {
  assert.match(inventoryStockView, /Print current view/);
  assert.match(inventoryStockView, /document\.body\.dataset\.printMode = "inventory"/);
  assert.match(inventoryStockView, /rows=\{sortedRows\}/);
  assert.match(inventoryStockView, /<th>Store<\/th>/);
  assert.match(inventoryStockView, /canViewCosts \? <th>Average cost<\/th> : null/);
  assert.match(printCss, /body\[data-print-mode="inventory"\] \[data-inventory-stock-screen\]/);
  assert.doesNotMatch(inventoryStockView, /api\/inventory\/export/);
});

console.log("Print and CSV export UX checks passed.");
