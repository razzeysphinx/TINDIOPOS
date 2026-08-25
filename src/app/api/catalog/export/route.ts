import { NextResponse } from "next/server";

import { loadCatalogExportData } from "@/features/catalog/data";
import { getBusinessContext, hasPermission } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function toMoneyInput(value: number) {
  return (value / 100).toFixed(2);
}

export async function GET() {
  const context = await getBusinessContext();
  if (!context) {
    return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  }
  if (!hasPermission(context, "products.manage")) {
    return NextResponse.json({ error: "Product management access is required." }, { status: 403 });
  }

  const exportData = await loadCatalogExportData(
    context,
    hasPermission(context, "products.view_cost"),
  );

  if (!exportData.ok) {
    return NextResponse.json(
      {
        error:
          exportData.stage === "catalog"
            ? "TINDIO could not export the catalogue."
            : "TINDIO could not export product costs.",
      },
      { status: 500 },
    );
  }

  const products = exportData.products;
  const costByProduct = new Map<string, number>();
  for (const cost of exportData.costs) {
    if (cost.variant_id === null) costByProduct.set(cost.product_id, cost.cost_minor);
  }

  const categoryById = new Map(
    exportData.categories.map((category) => [category.id, category.name]),
  );
  const rows: Array<Array<string | number>> = [
    [
      "name",
      "description",
      "category",
      "sku",
      "barcode",
      "price",
      "cost",
      "track_inventory",
      "unit",
      "image_url",
      "variable_price",
      "allow_fractional_quantity",
      "store_price",
      "low_stock_level",
    ],
    ...products.map((product) => [
      product.name,
      product.description ?? "",
      product.category_id ? categoryById.get(product.category_id) ?? "" : "",
      product.sku ?? "",
      product.barcode ?? "",
      toMoneyInput(product.price_minor),
      toMoneyInput(costByProduct.get(product.id) ?? 0),
      product.track_inventory ? "yes" : "no",
      product.unit,
      product.image_url ?? "",
      product.is_variable_price ? "yes" : "no",
      product.allow_fractional_quantity ? "yes" : "no",
      "",
      "",
    ]),
  ];
  const body = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const filename = `tindio-catalog-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
