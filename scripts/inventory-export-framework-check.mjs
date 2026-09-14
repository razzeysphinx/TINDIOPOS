import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

const [framework, reportRoute, catalogRoute, customerRoute, supplierRoute, countWorkspace, catalogForms, customerTools, supplierTools] = await Promise.all([
  source("src/lib/export-framework.ts"),
  source("src/app/api/reports/export/route.ts"),
  source("src/app/api/catalog/export/route.ts"),
  source("src/app/api/customers/export/route.ts"),
  source("src/app/api/inventory/suppliers/export/route.ts"),
  source("src/features/inventory/inventory-count-workspace.tsx"),
  source("src/features/catalog/catalog-forms.tsx"),
  source("src/features/customers/customer-csv-tools.tsx"),
  source("src/features/inventory/supplier-csv-tools.tsx"),
]);

test("Phase 12 defines the existing export families, formats, and standard filenames in one place", () => {
  for (const family of ["snapshot", "activity", "document", "audit", "round_trip"]) {
    assert.match(framework, new RegExp(`ExportFamily = .*"${family}"`));
  }
  for (const definition of [
    "catalog-product-master",
    "customers-master",
    "inventory-count-template",
    "reports-sales",
    "reports-inventory",
    "reports-security",
    "suppliers-master",
  ]) {
    assert.match(framework, new RegExp(`"${definition}"`));
  }
  assert.match(framework, /sensitiveCostData/);
  assert.match(framework, /\["TINDIO", definition\.module, definition\.exportName/);
  assert.match(framework, /"Cache-Control": "private, no-store"/);
  assert.match(framework, /"X-Content-Type-Options": "nosniff"/);
});

test("existing exports use the common CSV response without moving their security checks", () => {
  for (const [route, permission, call] of [
    [reportRoute, "reports.view", "csvExportResponse(exportDefinitionByKind"],
    [catalogRoute, "products.manage", "csvExportResponse(\"catalog-product-master\""],
    [customerRoute, "customers.manage", "csvExportResponse(\"customers-master\""],
    [supplierRoute, "inventory.manage", "csvExportResponse(\"suppliers-master\""],
  ]) {
    assert.match(route, new RegExp(`hasPermission\\(context, "${permission.replace(".", "\\.")}"`));
    assert.ok(route.includes(call));
  }
  assert.match(reportRoute, /hasAuthorizedReportStoreSelection/);
  assert.match(reportRoute, /resolveScopedReportFilter/);
  assert.match(catalogRoute, /includeCosts = hasPermission\(context, "products\.view_cost"\)/);
});

test("round-trip templates use the shared filename/download helpers while preserving count validation", () => {
  for (const [content, definition] of [
    [catalogForms, "catalog-import-template"],
    [customerTools, "customers-import-template"],
    [supplierTools, "suppliers-import-template"],
    [countWorkspace, "inventory-count-template"],
  ]) {
    assert.match(content, /downloadCsvText/);
    assert.match(content, new RegExp(`exportFilename\\(\"${definition}\"`));
  }
  assert.match(countWorkspace, /Choose the official TINDIO count spreadsheet exported from this count document/);
  assert.match(countWorkspace, /Blank cells remain uncounted/);
  assert.match(framework, /includeBom/);
});
