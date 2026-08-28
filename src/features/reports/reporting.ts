import "server-only";

import { z } from "zod";

import {
  canAccessAllBackOfficeStores,
  resolveBackOfficeStoreScope,
} from "@/lib/server/back-office-store-scope";
import type { BusinessContext } from "@/lib/auth/dal";
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
  return canAccessAllBackOfficeStores(context);
}

export function canQueryReportingScope(context: BusinessContext) {
  return hasOrganizationReportingScope(context) || context.storeIds.length > 0;
}

export function resolveScopedReportFilter(
  context: BusinessContext,
  searchParams: { start?: string | string[]; end?: string | string[]; store?: string | string[] },
) {
  const filter = resolveReportFilter(searchParams, context.organization.timezone);
  const scope = resolveBackOfficeStoreScope(context, searchParams);

  if (scope.invalidSelection || hasOrganizationReportingScope(context)) {
    return filter;
  }

  return {
    ...filter,
    storeId: scope.selectedStoreId,
  };
}

export function hasAuthorizedReportStoreSelection(
  context: BusinessContext,
  searchParams: { store?: string | string[] },
) {
  return !resolveBackOfficeStoreScope(context, searchParams).invalidSelection;
}

export async function getReportingSnapshot(
  context: BusinessContext,
  filter: ReportFilter,
  mode: "dashboard" | "reports",
): Promise<ReportSnapshot> {
  if (
    !hasOrganizationReportingScope(context) &&
    (context.storeIds.length === 0 || (filter.storeId && !context.storeIds.includes(filter.storeId)))
  ) {
    throw new Error("Reporting requires an assigned store.");
  }

  const supabase = await createClient();
  const loadOne = async (storeId: string | null) => {
    const { data, error } = await supabase.rpc(
      mode === "dashboard" ? "get_dashboard_snapshot" : "get_reports_snapshot",
      {
        target_organization_id: context.organization.id,
        target_start_date: filter.startDate,
        target_end_date: filter.endDate,
        ...(storeId ? { target_store_id: storeId } : {}),
      },
    );

    if (error || !data) {
      throw new Error(`Unable to load reporting data: ${error?.message ?? "No data returned"}`);
    }

    return reportSnapshotSchema.parse(data as Json);
  };

  // The reporting RPC intentionally requires a single assigned store for
  // non-organization-wide roles. Consolidate only independently authorized
  // store snapshots; never call the organization-wide RPC for those users.
  if (!hasOrganizationReportingScope(context) && !filter.storeId) {
    const snapshots = await Promise.all(
      [...new Set(context.storeIds)].map((storeId) => loadOne(storeId)),
    );
    return mergeReportingSnapshots(snapshots, filter);
  }

  return loadOne(filter.storeId);
}

function mergeReportingSnapshots(snapshots: ReportSnapshot[], filter: ReportFilter): ReportSnapshot {
  const first = snapshots[0];
  if (!first) {
    throw new Error("Reporting requires an assigned store.");
  }

  const mergeRows = <T>(
    rows: T[][],
    key: (row: T) => string,
    merge: (left: T, right: T) => T,
  ) => Array.from(rows.flat().reduce((result, row) => {
    const current = result.get(key(row));
    result.set(key(row), current ? merge(current, row) : row);
    return result;
  }, new Map<string, T>()).values());
  const sum = (selector: (snapshot: ReportSnapshot) => number | null) => snapshots.reduce(
    (total, snapshot) => total + (selector(snapshot) ?? 0),
    0,
  );
  const costAccess = snapshots.every((snapshot) => snapshot.summary.cost_access);
  const transactionCount = sum((snapshot) => snapshot.summary.transaction_count);

  return {
    period: { ...first.period, store_id: null, start_date: filter.startDate, end_date: filter.endDate },
    summary: {
      ...first.summary,
      gross_sales_minor: sum((snapshot) => snapshot.summary.gross_sales_minor),
      sales_total_minor: sum((snapshot) => snapshot.summary.sales_total_minor),
      refunds_minor: sum((snapshot) => snapshot.summary.refunds_minor),
      net_sales_minor: sum((snapshot) => snapshot.summary.net_sales_minor),
      transaction_count: transactionCount,
      average_order_minor: transactionCount
        ? Math.round(sum((snapshot) => snapshot.summary.sales_total_minor) / transactionCount)
        : 0,
      discounts_minor: sum((snapshot) => snapshot.summary.discounts_minor),
      taxes_minor: sum((snapshot) => snapshot.summary.taxes_minor),
      cost_access: costAccess,
      cogs_minor: costAccess ? sum((snapshot) => snapshot.summary.cogs_minor) : null,
      gross_profit_minor: costAccess ? sum((snapshot) => snapshot.summary.gross_profit_minor) : null,
      gross_margin_bps: costAccess && sum((snapshot) => snapshot.summary.net_sales_minor)
        ? Math.round(sum((snapshot) => snapshot.summary.gross_profit_minor) / sum((snapshot) => snapshot.summary.net_sales_minor) * 10_000)
        : null,
      estimated_gross_profit_minor: costAccess ? sum((snapshot) => snapshot.summary.estimated_gross_profit_minor) : null,
    },
    sales_by_day: mergeRows(snapshots.map((snapshot) => snapshot.sales_by_day), (row) => row.date, (left, right) => ({
      ...left,
      sales_minor: left.sales_minor + right.sales_minor,
      refunds_minor: left.refunds_minor + right.refunds_minor,
      net_sales_minor: left.net_sales_minor + right.net_sales_minor,
      transaction_count: left.transaction_count + right.transaction_count,
    })).sort((left, right) => left.date.localeCompare(right.date)),
    top_products: mergeRows(snapshots.map((snapshot) => snapshot.top_products), (row) => `${row.product_id}:${row.variant_id ?? ""}`, (left, right) => ({
      ...left,
      quantity_sold: left.quantity_sold + right.quantity_sold,
      quantity_refunded: left.quantity_refunded + right.quantity_refunded,
      sales_minor: left.sales_minor + right.sales_minor,
      refunds_minor: left.refunds_minor + right.refunds_minor,
      net_sales_minor: left.net_sales_minor + right.net_sales_minor,
    })).sort((left, right) => right.net_sales_minor - left.net_sales_minor || left.name.localeCompare(right.name)).slice(0, 10),
    sales_by_category: mergeRows(snapshots.map((snapshot) => snapshot.sales_by_category), (row) => row.name, (left, right) => ({
      ...left,
      sales_minor: left.sales_minor + right.sales_minor,
      quantity_sold: left.quantity_sold + right.quantity_sold,
    })).sort((left, right) => right.sales_minor - left.sales_minor || left.name.localeCompare(right.name)),
    sales_by_employee: mergeRows(snapshots.map((snapshot) => snapshot.sales_by_employee), (row) => row.employee_id, (left, right) => ({
      ...left,
      transaction_count: left.transaction_count + right.transaction_count,
      sales_minor: left.sales_minor + right.sales_minor,
    })).sort((left, right) => right.sales_minor - left.sales_minor || left.name.localeCompare(right.name)),
    sales_by_store: mergeRows(snapshots.map((snapshot) => snapshot.sales_by_store), (row) => row.store_id, (left, right) => ({
      ...left,
      transaction_count: left.transaction_count + right.transaction_count,
      sales_minor: left.sales_minor + right.sales_minor,
    })).sort((left, right) => right.sales_minor - left.sales_minor || left.name.localeCompare(right.name)),
    sales_by_register: mergeRows(snapshots.map((snapshot) => snapshot.sales_by_register), (row) => row.register_id, (left, right) => ({
      ...left,
      transaction_count: left.transaction_count + right.transaction_count,
      sales_minor: left.sales_minor + right.sales_minor,
    })).sort((left, right) => right.sales_minor - left.sales_minor || left.name.localeCompare(right.name)),
    sales_by_customer: mergeRows(snapshots.map((snapshot) => snapshot.sales_by_customer), (row) => row.customer_id, (left, right) => ({
      ...left,
      transaction_count: left.transaction_count + right.transaction_count,
      sales_minor: left.sales_minor + right.sales_minor,
    })).sort((left, right) => right.sales_minor - left.sales_minor || left.name.localeCompare(right.name)),
    sales_by_hour: mergeRows(snapshots.map((snapshot) => snapshot.sales_by_hour), (row) => String(row.hour), (left, right) => ({
      ...left,
      transaction_count: left.transaction_count + right.transaction_count,
      sales_minor: left.sales_minor + right.sales_minor,
    })).sort((left, right) => left.hour - right.hour),
    payments: mergeRows(snapshots.map((snapshot) => snapshot.payments), (row) => `${row.name}:${row.type}`, (left, right) => ({
      ...left,
      amount_minor: left.amount_minor + right.amount_minor,
      payment_count: left.payment_count + right.payment_count,
    })).sort((left, right) => right.amount_minor - left.amount_minor || left.name.localeCompare(right.name)),
    inventory: {
      ...first.inventory,
      cost_access: costAccess,
      stock_item_count: sum((snapshot) => snapshot.inventory.stock_item_count),
      on_hand_quantity: sum((snapshot) => snapshot.inventory.on_hand_quantity),
      low_stock_count: sum((snapshot) => snapshot.inventory.low_stock_count),
      out_of_stock_count: sum((snapshot) => snapshot.inventory.out_of_stock_count),
      negative_stock_count: sum((snapshot) => snapshot.inventory.negative_stock_count),
      dead_stock_count: sum((snapshot) => snapshot.inventory.dead_stock_count),
      inventory_valuation_minor: costAccess ? sum((snapshot) => snapshot.inventory.inventory_valuation_minor) : null,
      fast_movers: mergeRows(snapshots.map((snapshot) => snapshot.inventory.fast_movers), (row) => `${row.product_id}:${row.variant_id ?? ""}`, (left, right) => ({
        ...left,
        quantity_sold: left.quantity_sold + right.quantity_sold,
        net_sales_minor: left.net_sales_minor + right.net_sales_minor,
      })).sort((left, right) => right.net_sales_minor - left.net_sales_minor).slice(0, 10),
      slow_movers: mergeRows(snapshots.map((snapshot) => snapshot.inventory.slow_movers), (row) => `${row.product_id}:${row.variant_id ?? ""}`, (left, right) => ({
        ...left,
        quantity_on_hand: left.quantity_on_hand + right.quantity_on_hand,
        quantity_sold: left.quantity_sold + right.quantity_sold,
      })).sort((left, right) => right.quantity_on_hand - left.quantity_on_hand).slice(0, 10),
      activity: {
        manual_adjustment_count: sum((snapshot) => snapshot.inventory.activity.manual_adjustment_count),
        purchase_receipt_count: sum((snapshot) => snapshot.inventory.activity.purchase_receipt_count),
        transfer_count: sum((snapshot) => snapshot.inventory.activity.transfer_count),
      },
      movement_by_type: mergeRows(snapshots.map((snapshot) => snapshot.inventory.movement_by_type), (row) => row.movement_type, (left, right) => ({
        ...left,
        movement_count: left.movement_count + right.movement_count,
        quantity_delta: left.quantity_delta + right.quantity_delta,
      })).sort((left, right) => left.movement_type.localeCompare(right.movement_type)),
    },
    security: {
      ...first.security,
      refund_count: sum((snapshot) => snapshot.security.refund_count),
      void_count: sum((snapshot) => snapshot.security.void_count),
      price_override_count: sum((snapshot) => snapshot.security.price_override_count),
      high_discount_count: sum((snapshot) => snapshot.security.high_discount_count),
      manager_approval_count: sum((snapshot) => snapshot.security.manager_approval_count),
      cash_discrepancy_count: sum((snapshot) => snapshot.security.cash_discrepancy_count),
      cash_discrepancy_minor: sum((snapshot) => snapshot.security.cash_discrepancy_minor),
      cash_discrepancy_absolute_minor: sum((snapshot) => snapshot.security.cash_discrepancy_absolute_minor),
      manual_inventory_change_count: sum((snapshot) => snapshot.security.manual_inventory_change_count),
      events: mergeRows(snapshots.map((snapshot) => snapshot.security.events), (row) => row.event_type, (left, right) => ({
        ...left,
        event_count: left.event_count + right.event_count,
      })).sort((left, right) => right.event_count - left.event_count || left.event_type.localeCompare(right.event_type)),
    },
  };
}

export function reportQueryString(filter: ReportFilter) {
  const query = new URLSearchParams({ start: filter.startDate, end: filter.endDate });
  if (filter.storeId) query.set("store", filter.storeId);
  return query.toString();
}
