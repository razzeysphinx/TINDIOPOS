import { csvRows } from "@/lib/csv";

/**
 * Shared metadata for exports that already exist in TINDIO. Definitions are
 * intentionally descriptive: each route/action remains responsible for its
 * own authoritative authorization and store-scope check before data is read.
 */
export type ExportFamily = "activity" | "audit" | "document" | "round_trip" | "snapshot";
export type ExportFormat = "csv" | "ndjson" | "print" | "xlsx";

type ExportDefinition = {
  exportName: string;
  family: ExportFamily;
  formats: readonly ExportFormat[];
  module: string;
  requiredPermission?: string;
  sensitiveCostData?: boolean;
};

export const exportDefinitions = {
  "catalog-import-template": { exportName: "Product-Import-Template", family: "round_trip", formats: ["csv"], module: "Catalog", requiredPermission: "products.manage" },
  "catalog-product-master": { exportName: "Product-Master", family: "snapshot", formats: ["csv"], module: "Catalog", requiredPermission: "products.manage", sensitiveCostData: true },
  "customers-import-template": { exportName: "Customer-Import-Template", family: "round_trip", formats: ["csv"], module: "Customers", requiredPermission: "customers.manage" },
  "customers-master": { exportName: "Customer-Master", family: "snapshot", formats: ["csv"], module: "Customers", requiredPermission: "customers.manage" },
  "inventory-count-template": { exportName: "Count-Template", family: "round_trip", formats: ["csv", "print"], module: "Inventory", requiredPermission: "inventory.count.create" },
  "reports-customers": { exportName: "Customer-Summary", family: "activity", formats: ["csv", "print"], module: "Reports", requiredPermission: "reports.view" },
  "reports-employees": { exportName: "Employee-Summary", family: "activity", formats: ["csv", "print"], module: "Reports", requiredPermission: "reports.view" },
  "reports-inventory": { exportName: "Inventory-Summary", family: "snapshot", formats: ["csv", "print"], module: "Reports", requiredPermission: "reports.view", sensitiveCostData: true },
  "reports-payments": { exportName: "Payment-Breakdown", family: "activity", formats: ["csv", "print"], module: "Reports", requiredPermission: "reports.view" },
  "reports-products": { exportName: "Product-Summary", family: "activity", formats: ["csv", "print"], module: "Reports", requiredPermission: "reports.view" },
  "reports-registers": { exportName: "Register-Summary", family: "activity", formats: ["csv", "print"], module: "Reports", requiredPermission: "reports.view" },
  "reports-sales": { exportName: "Sales-Summary", family: "activity", formats: ["csv", "print"], module: "Reports", requiredPermission: "reports.view" },
  "reports-security": { exportName: "Security-Audit", family: "audit", formats: ["csv", "print"], module: "Reports", requiredPermission: "reports.view" },
  "suppliers-import-template": { exportName: "Supplier-Import-Template", family: "round_trip", formats: ["csv"], module: "Inventory", requiredPermission: "purchasing.suppliers.manage" },
  "suppliers-master": { exportName: "Supplier-Master", family: "snapshot", formats: ["csv"], module: "Inventory", requiredPermission: "inventory.manage" },
} as const satisfies Record<string, ExportDefinition>;

export type ExportDefinitionId = keyof typeof exportDefinitions;
type CsvRow = Array<string | number>;

function safeFilenamePart(value: string) {
  return value
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "All-Stores";
}

function datePart(value?: Date | string) {
  if (typeof value === "string") {
    const matchedDates = value.match(/\d{4}-\d{2}-\d{2}/g);
    if (matchedDates?.length) return matchedDates.join("-to-");
  }

  const date = value instanceof Date ? value : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

export function exportFilename(
  definitionId: ExportDefinitionId,
  { date, extension = "csv", scope = "All-Stores" }: { date?: Date | string; extension?: string; scope?: string } = {},
) {
  const definition = exportDefinitions[definitionId];
  return ["TINDIO", definition.module, definition.exportName, safeFilenamePart(scope), datePart(date)]
    .map(safeFilenamePart)
    .join("_")
    .concat(`.${safeFilenamePart(extension).toLowerCase()}`);
}

export function csvExportResponse(
  definitionId: ExportDefinitionId,
  rows: CsvRow[],
  options?: { date?: Date | string; scope?: string },
) {
  return new Response(csvRows(rows), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${exportFilename(definitionId, options)}"`,
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function downloadCsvText(filename: string, content: string, includeBom = false) {
  const url = URL.createObjectURL(new Blob([includeBom ? `\uFEFF${content}` : content], { type: "text/csv;charset=utf-8" }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
