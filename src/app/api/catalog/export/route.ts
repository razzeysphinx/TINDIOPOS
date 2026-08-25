import { NextResponse } from "next/server";

import { getBusinessContext, hasPermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

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

  const supabase = await createClient();
  const [categoriesResult, productsResult] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name")
      .eq("organization_id", context.organization.id),
    supabase
      .from("products")
      .select(
        "id, category_id, name, description, sku, barcode, price_minor, track_inventory, unit, image_url, is_variable_price, allow_fractional_quantity",
      )
      .eq("organization_id", context.organization.id)
      .eq("product_type", "simple")
      .eq("is_composite", false)
      .eq("status", "active")
      .order("name", { ascending: true }),
  ]);

  if (categoriesResult.error || productsResult.error) {
    return NextResponse.json({ error: "TINDIO could not export the catalogue." }, { status: 500 });
  }

  const products = productsResult.data ?? [];
  const costByProduct = new Map<string, number>();
  if (hasPermission(context, "products.view_cost") && products.length > 0) {
    const costsResult = await supabase.rpc("get_catalog_costs", {
      target_organization_id: context.organization.id,
      requested_product_ids: products.map((product) => product.id),
    });
    if (costsResult.error) {
      return NextResponse.json({ error: "TINDIO could not export product costs." }, { status: 500 });
    }
    for (const cost of costsResult.data ?? []) {
      if (cost.variant_id === null) costByProduct.set(cost.product_id, cost.cost_minor);
    }
  }

  const categoryById = new Map(
    (categoriesResult.data ?? []).map((category) => [category.id, category.name]),
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
