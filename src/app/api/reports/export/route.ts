import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getReportingSnapshot, resolveReportFilter, type ReportSnapshot } from "@/features/reports/reporting";
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

function rowsForExport(kind: z.infer<typeof exportKindSchema>, snapshot: ReportSnapshot) {
  switch (kind) {
    case "sales": {
      const costHeaders = snapshot.summary.cost_access
        ? ["COGS (minor units)", "Gross profit (minor units)", "Gross margin (basis points)"]
        : [];
      const costTotals = snapshot.summary.cost_access
        ? [
            snapshot.summary.cogs_minor ?? 0,
            snapshot.summary.gross_profit_minor ?? 0,
            snapshot.summary.gross_margin_bps ?? "",
          ]
        : [];
      return [
        [
          "Date",
          "Gross sales (minor units)",
          "Completed sales (minor units)",
          "Refunds (minor units)",
          "Net sales (minor units)",
          "Discounts (minor units)",
          "Taxes (minor units)",
          "Transactions",
          "Average order (minor units)",
          ...costHeaders,
        ],
        [
          "Period total",
          snapshot.summary.gross_sales_minor,
          snapshot.summary.sales_total_minor,
          snapshot.summary.refunds_minor,
          snapshot.summary.net_sales_minor,
          snapshot.summary.discounts_minor,
          snapshot.summary.taxes_minor,
          snapshot.summary.transaction_count,
          snapshot.summary.average_order_minor,
          ...costTotals,
        ],
        ...snapshot.sales_by_day.map((day) => [
          day.date,
          "",
          day.sales_minor,
          day.refunds_minor,
          day.net_sales_minor,
          "",
          "",
          day.transaction_count,
          "",
          ...costHeaders.map(() => ""),
        ]),
      ];
    }
    case "inventory": {
      const healthRows: Array<Array<string | number>> = [
        ["Health", "Stock positions", snapshot.inventory.stock_item_count, ""],
        ["Health", "Units on hand", snapshot.inventory.on_hand_quantity, ""],
        ["Health", "Low stock", snapshot.inventory.low_stock_count, ""],
        ["Health", "Out of stock", snapshot.inventory.out_of_stock_count, ""],
        ["Health", "Negative stock", snapshot.inventory.negative_stock_count, ""],
        ["Health", "Dead stock", snapshot.inventory.dead_stock_count, ""],
        ["Activity", "Manual inventory changes", snapshot.inventory.activity.manual_adjustment_count, ""],
        ["Activity", "Purchase receipts", snapshot.inventory.activity.purchase_receipt_count, ""],
        ["Activity", "Transfers", snapshot.inventory.activity.transfer_count, ""],
      ];
      if (snapshot.inventory.cost_access) {
        healthRows.push(["Valuation", "Inventory valuation (minor units)", snapshot.inventory.inventory_valuation_minor ?? 0, ""]);
      }
      return [
        ["Type", "Name", "Count", "Quantity or amount"],
        ...healthRows,
        ...snapshot.inventory.movement_by_type.map((movement) => [
          "Movement",
          movement.movement_type,
          movement.movement_count,
          movement.quantity_delta,
        ]),
        ...snapshot.inventory.fast_movers.map((product) => ["Fast mover", product.name, product.quantity_sold, product.net_sales_minor]),
        ...snapshot.inventory.slow_movers.map((product) => ["Slow mover", product.name, product.quantity_sold, product.quantity_on_hand]),
      ];
    }
    case "employees":
      return [
        ["Employee", "Transactions", "Sales (minor units)"],
        ...snapshot.sales_by_employee.map((employee) => [
          employee.name,
          employee.transaction_count,
          employee.sales_minor,
        ]),
      ];
    case "payments":
      return [
        ["Payment method", "Payment type", "Payments", "Amount (minor units)"],
        ...snapshot.payments.map((payment) => [
          payment.name,
          payment.type,
          payment.payment_count,
          payment.amount_minor,
        ]),
      ];
    case "registers":
      return [
        ["Register", "Transactions", "Sales (minor units)"],
        ...snapshot.sales_by_register.map((register) => [
          register.name,
          register.transaction_count,
          register.sales_minor,
        ]),
      ];
    case "customers":
      return [
        ["Customer", "Transactions", "Sales (minor units)"],
        ...snapshot.sales_by_customer.map((customer) => [
          customer.name,
          customer.transaction_count,
          customer.sales_minor,
        ]),
      ];
    case "security":
      return [
        ["Type", "Metric", "Count", "Amount (minor units)"],
        ["Summary", "Refunds", snapshot.security.refund_count, snapshot.summary.refunds_minor],
        ["Summary", "Voids", snapshot.security.void_count, ""],
        ["Summary", "Price overrides", snapshot.security.price_override_count, ""],
        ["Summary", "High discounts", snapshot.security.high_discount_count, ""],
        ["Summary", "Manager approvals", snapshot.security.manager_approval_count, ""],
        ["Summary", "Cash discrepancies", snapshot.security.cash_discrepancy_count, snapshot.security.cash_discrepancy_minor],
        ["Summary", "Absolute cash discrepancy", "", snapshot.security.cash_discrepancy_absolute_minor],
        ["Summary", "Manual inventory changes", snapshot.security.manual_inventory_change_count, ""],
        ...snapshot.security.events.map((event) => ["Audit event", event.event_type, event.event_count, ""]),
      ];
  }
}

export async function GET(request: NextRequest) {
  const context = await getBusinessContext();

  if (!context) {
    return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  }

  if (!hasPermission(context, "reports.view")) {
    return NextResponse.json({ error: "Reporting access is not permitted." }, { status: 403 });
  }

  const kind = exportKindSchema.safeParse(request.nextUrl.searchParams.get("kind"));
  if (!kind.success) {
    return NextResponse.json({ error: "Choose a supported report export." }, { status: 400 });
  }

  const filter = resolveReportFilter(
    {
      start: request.nextUrl.searchParams.get("start") ?? undefined,
      end: request.nextUrl.searchParams.get("end") ?? undefined,
      store: request.nextUrl.searchParams.get("store") ?? undefined,
    },
    context.organization.timezone,
  );
  const snapshot = await getReportingSnapshot(context, filter, "reports");
  const filename = `tindio-${kind.data}-report-${filter.startDate}-to-${filter.endDate}.csv`;

  return new Response(csvRows(rowsForExport(kind.data, snapshot)), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
