import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { loadReportStores } from "@/features/reports/data";
import {
  canQueryReportingScope,
  getReportingSnapshot,
  hasAuthorizedReportStoreSelection,
  resolveScopedReportFilter,
  type ReportSnapshot,
} from "@/features/reports/reporting";
import { getBusinessContext, hasPermission } from "@/lib/auth/dal";
import { csvRows } from "@/lib/csv";

const exportKindSchema = z.enum([
  "sales",
  "inventory",
  "employees",
  "payments",
  "registers",
  "customers",
  "security",
]);

type StoreSnapshot = {
  store: { id: string; name: string };
  snapshot: ReportSnapshot;
};

/** Every exported row has a store identifier. Consolidated totals are
 * intentionally represented by multiple, branch-specific rows instead of an
 * ambiguous organization-wide total. */
function rowsForExport(kind: z.infer<typeof exportKindSchema>, storeSnapshots: StoreSnapshot[]) {
  switch (kind) {
    case "sales":
      return [
        ["store_id", "store_name", "gross_sales_minor", "completed_sales_minor", "refunds_minor", "net_sales_minor", "discounts_minor", "taxes_minor", "transactions", "average_order_minor"],
        ...storeSnapshots.map(({ store, snapshot }) => [store.id, store.name, snapshot.summary.gross_sales_minor, snapshot.summary.sales_total_minor, snapshot.summary.refunds_minor, snapshot.summary.net_sales_minor, snapshot.summary.discounts_minor, snapshot.summary.taxes_minor, snapshot.summary.transaction_count, snapshot.summary.average_order_minor]),
      ];
    case "inventory":
      return [
        ["store_id", "store_name", "metric", "value"],
        ...storeSnapshots.flatMap(({ store, snapshot }) => [
          [store.id, store.name, "Stock positions", snapshot.inventory.stock_item_count],
          [store.id, store.name, "Units on hand", snapshot.inventory.on_hand_quantity],
          [store.id, store.name, "Low stock", snapshot.inventory.low_stock_count],
          [store.id, store.name, "Out of stock", snapshot.inventory.out_of_stock_count],
          [store.id, store.name, "Negative stock", snapshot.inventory.negative_stock_count],
          [store.id, store.name, "Dead stock", snapshot.inventory.dead_stock_count],
          [store.id, store.name, "Inventory valuation (minor units)", snapshot.inventory.inventory_valuation_minor ?? ""],
          ...snapshot.inventory.movement_by_type.map((movement) => [store.id, store.name, `Movement: ${movement.movement_type}`, movement.quantity_delta]),
        ]),
      ];
    case "employees":
      return [
        ["store_id", "store_name", "employee", "transactions", "sales_minor"],
        ...storeSnapshots.flatMap(({ store, snapshot }) => snapshot.sales_by_employee.map((employee) => [store.id, store.name, employee.name, employee.transaction_count, employee.sales_minor])),
      ];
    case "payments":
      return [
        ["store_id", "store_name", "payment_method", "payment_type", "payment_count", "amount_minor"],
        ...storeSnapshots.flatMap(({ store, snapshot }) => snapshot.payments.map((payment) => [store.id, store.name, payment.name, payment.type, payment.payment_count, payment.amount_minor])),
      ];
    case "registers":
      return [
        ["store_id", "store_name", "register_id", "register", "transactions", "sales_minor"],
        ...storeSnapshots.flatMap(({ store, snapshot }) => snapshot.sales_by_register.map((register) => [store.id, store.name, register.register_id, register.name, register.transaction_count, register.sales_minor])),
      ];
    case "customers":
      return [
        ["store_id", "store_name", "customer_id", "customer", "transactions", "sales_minor"],
        ...storeSnapshots.flatMap(({ store, snapshot }) => snapshot.sales_by_customer.map((customer) => [store.id, store.name, customer.customer_id, customer.name, customer.transaction_count, customer.sales_minor])),
      ];
    case "security":
      return [
        ["store_id", "store_name", "metric", "count", "amount_minor"],
        ...storeSnapshots.flatMap(({ store, snapshot }) => [
          [store.id, store.name, "Refunds", snapshot.security.refund_count, snapshot.summary.refunds_minor],
          [store.id, store.name, "Voids", snapshot.security.void_count, ""],
          [store.id, store.name, "Price overrides", snapshot.security.price_override_count, ""],
          [store.id, store.name, "High discounts", snapshot.security.high_discount_count, ""],
          [store.id, store.name, "Manager approvals", snapshot.security.manager_approval_count, ""],
          [store.id, store.name, "Cash discrepancies", snapshot.security.cash_discrepancy_count, snapshot.security.cash_discrepancy_minor],
          ...snapshot.security.events.map((event) => [store.id, store.name, `Audit event: ${event.event_type}`, event.event_count, ""]),
        ]),
      ];
  }
}

export async function GET(request: NextRequest) {
  const context = await getBusinessContext();
  if (!context) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (!hasPermission(context, "reports.view")) return NextResponse.json({ error: "Reporting access is not permitted." }, { status: 403 });

  const kind = exportKindSchema.safeParse(request.nextUrl.searchParams.get("kind"));
  if (!kind.success) return NextResponse.json({ error: "Choose a supported report export." }, { status: 400 });
  if (!canQueryReportingScope(context)) return NextResponse.json({ error: "An assigned store is required for reporting." }, { status: 403 });

  const requestedScope = { store: request.nextUrl.searchParams.get("store") ?? undefined };
  if (!hasAuthorizedReportStoreSelection(context, requestedScope)) {
    return NextResponse.json({ error: "The requested store is not available to this employee." }, { status: 403 });
  }

  const filter = resolveScopedReportFilter(context, {
    start: request.nextUrl.searchParams.get("start") ?? undefined,
    end: request.nextUrl.searchParams.get("end") ?? undefined,
    store: request.nextUrl.searchParams.get("store") ?? undefined,
  });
  const stores = (await loadReportStores(context)).filter((store) => !filter.storeId || store.id === filter.storeId);
  if (stores.length === 0) return NextResponse.json({ error: "No authorized store is available for this export." }, { status: 403 });

  const storeSnapshots = await Promise.all(stores.map(async (store) => ({
    store,
    snapshot: await getReportingSnapshot(context, { ...filter, storeId: store.id }, "reports"),
  })));
  const filename = `tindio-${kind.data}-report-${filter.startDate}-to-${filter.endDate}.csv`;

  return new Response(csvRows(rowsForExport(kind.data, storeSnapshots)), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
