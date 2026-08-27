import "server-only";

import { z } from "zod";

import { hasPermission, type BusinessContext } from "@/lib/auth/dal";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export type ReportFilter = {
  startDate: string;
  endDate: string;
  storeId: string | null;
};

const reportSnapshotSchema = z.object({
  period: z.object({
    start_date: z.string(),
    end_date: z.string(),
    store_id: z.string().uuid().nullable(),
    timezone: z.string(),
  }),
  summary: z.object({
    gross_sales_minor: z.number(),
    sales_total_minor: z.number(),
    refunds_minor: z.number(),
    net_sales_minor: z.number(),
    transaction_count: z.number(),
    average_order_minor: z.number(),
    discounts_minor: z.number(),
    taxes_minor: z.number(),
    cost_access: z.boolean(),
    cogs_minor: z.number().nullable(),
    gross_profit_minor: z.number().nullable(),
    gross_margin_bps: z.number().nullable(),
    estimated_gross_profit_minor: z.number().nullable(),
  }),
  sales_by_day: z.array(
    z.object({
      date: z.string(),
      sales_minor: z.number(),
      refunds_minor: z.number(),
      net_sales_minor: z.number(),
      transaction_count: z.number(),
    }),
  ),
  top_products: z.array(
    z.object({
      product_id: z.string().uuid(),
      variant_id: z.string().uuid().nullable(),
      name: z.string(),
      quantity_sold: z.number(),
      quantity_refunded: z.number(),
      sales_minor: z.number(),
      refunds_minor: z.number(),
      net_sales_minor: z.number(),
    }),
  ),
  sales_by_category: z.array(
    z.object({ name: z.string(), sales_minor: z.number(), quantity_sold: z.number() }),
  ),
  sales_by_employee: z.array(
    z.object({
      employee_id: z.string().uuid(),
      name: z.string(),
      transaction_count: z.number(),
      sales_minor: z.number(),
    }),
  ),
  sales_by_store: z.array(
    z.object({
      store_id: z.string().uuid(),
      name: z.string(),
      transaction_count: z.number(),
      sales_minor: z.number(),
    }),
  ),
  sales_by_register: z.array(
    z.object({
      register_id: z.string().uuid(),
      name: z.string(),
      transaction_count: z.number(),
      sales_minor: z.number(),
    }),
  ),
  sales_by_customer: z.array(
    z.object({
      customer_id: z.string().uuid(),
      name: z.string(),
      transaction_count: z.number(),
      sales_minor: z.number(),
    }),
  ),
  sales_by_hour: z.array(
    z.object({
      hour: z.number(),
      label: z.string(),
      transaction_count: z.number(),
      sales_minor: z.number(),
    }),
  ),
  payments: z.array(
    z.object({ name: z.string(), type: z.string(), amount_minor: z.number(), payment_count: z.number() }),
  ),
  inventory: z.object({
    cost_access: z.boolean(),
    stock_item_count: z.number(),
    on_hand_quantity: z.number(),
    low_stock_count: z.number(),
    out_of_stock_count: z.number(),
    negative_stock_count: z.number(),
    dead_stock_count: z.number(),
    inventory_valuation_minor: z.number().nullable(),
    fast_movers: z.array(
      z.object({
        product_id: z.string().uuid(),
        variant_id: z.string().uuid().nullable(),
        name: z.string(),
        quantity_sold: z.number(),
        net_sales_minor: z.number(),
      }),
    ),
    slow_movers: z.array(
      z.object({
        product_id: z.string().uuid(),
        variant_id: z.string().uuid().nullable(),
        name: z.string(),
        quantity_on_hand: z.number(),
        quantity_sold: z.number(),
      }),
    ),
    activity: z.object({
      manual_adjustment_count: z.number(),
      purchase_receipt_count: z.number(),
      transfer_count: z.number(),
    }),
    movement_by_type: z.array(
      z.object({ movement_type: z.string(), movement_count: z.number(), quantity_delta: z.number() }),
    ),
  }),
  security: z.object({
    refund_count: z.number(),
    void_count: z.number(),
    price_override_count: z.number(),
    high_discount_count: z.number(),
    manager_approval_count: z.number(),
    cash_discrepancy_count: z.number(),
    cash_discrepancy_minor: z.number(),
    cash_discrepancy_absolute_minor: z.number(),
    manual_inventory_change_count: z.number(),
    events: z.array(z.object({ event_type: z.string(), event_count: z.number() })),
  }),
});

export type ReportSnapshot = z.infer<typeof reportSnapshotSchema>;

function firstString(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function isDate(value: string | undefined): value is string {
  if (!value || !datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function dateInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));
  return `${valueByType.get("year")}-${valueByType.get("month")}-${valueByType.get("day")}`;
}

function daysBefore(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

export function resolveReportFilter(
  searchParams: { start?: string | string[]; end?: string | string[]; store?: string | string[] },
  timezone: string,
): ReportFilter {
  const today = dateInTimezone(timezone);
  const defaultFilter = { startDate: daysBefore(today, 29), endDate: today, storeId: null };
  const startDate = firstString(searchParams.start);
  const endDate = firstString(searchParams.end);
  const storeCandidate = firstString(searchParams.store);
  const storeId = z.uuid().safeParse(storeCandidate).success ? storeCandidate ?? null : null;

  if (!isDate(startDate) || !isDate(endDate) || endDate < startDate) return defaultFilter;
  const rangeDays = Math.round(
    (new Date(`${endDate}T00:00:00.000Z`).valueOf() -
      new Date(`${startDate}T00:00:00.000Z`).valueOf()) /
      86_400_000,
  );

  if (rangeDays > 365) return defaultFilter;
  return { startDate, endDate, storeId };
}

/**
 * Store management is the explicit organization-wide reporting authority.
 * Everyone else who can report is constrained to stores assigned to their
 * employee record. This is permission-based intentionally: a renamed system
 * role or a custom role cannot accidentally change data scope.
 */
export function hasOrganizationReportingScope(context: BusinessContext) {
  return hasPermission(context, "stores.manage");
}

export function canQueryReportingScope(context: BusinessContext) {
  return hasOrganizationReportingScope(context) || context.storeIds.length > 0;
}

export function resolveScopedReportFilter(
  context: BusinessContext,
  searchParams: { start?: string | string[]; end?: string | string[]; store?: string | string[] },
) {
  const filter = resolveReportFilter(searchParams, context.organization.timezone);

  if (hasOrganizationReportingScope(context)) {
    return filter;
  }

  return {
    ...filter,
    storeId: filter.storeId && context.storeIds.includes(filter.storeId)
      ? filter.storeId
      : context.storeIds[0] ?? null,
  };
}

export async function getReportingSnapshot(
  context: BusinessContext,
  filter: ReportFilter,
  mode: "dashboard" | "reports",
): Promise<ReportSnapshot> {
  if (
    !hasOrganizationReportingScope(context) &&
    (!filter.storeId || !context.storeIds.includes(filter.storeId))
  ) {
    throw new Error("Reporting requires an assigned store.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    mode === "dashboard" ? "get_dashboard_snapshot" : "get_reports_snapshot",
    {
      target_organization_id: context.organization.id,
      target_start_date: filter.startDate,
      target_end_date: filter.endDate,
      ...(filter.storeId ? { target_store_id: filter.storeId } : {}),
    },
  );

  if (error || !data) {
    throw new Error(`Unable to load reporting data: ${error?.message ?? "No data returned"}`);
  }

  return reportSnapshotSchema.parse(data as Json);
}

export function reportQueryString(filter: ReportFilter) {
  const query = new URLSearchParams({ start: filter.startDate, end: filter.endDate });
  if (filter.storeId) query.set("store", filter.storeId);
  return query.toString();
}
