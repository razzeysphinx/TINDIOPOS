import "server-only";

import { z } from "zod";

import type { BeginnerSetupItem } from "@/features/dashboard/beginner-setup-types";
import type { ReportFilter } from "@/features/reports/reporting";
import { hasAnyPermission, hasPermission, type BusinessContext } from "@/lib/auth/dal";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

const dashboardOperationalSnapshotSchema = z.object({
  access: z.object({
    approvals: z.boolean(),
    cost: z.boolean(),
    customers: z.boolean(),
    devices: z.boolean(),
    inventory: z.boolean(),
    organization_wide: z.boolean(),
    shifts: z.boolean(),
    team: z.boolean(),
    tickets: z.boolean(),
  }),
  cost: z.object({
    sold_line_count: z.number().nullable(),
    missing_sales_cost_line_count: z.number().nullable(),
    missing_sales_cost_item_count: z.number().nullable(),
    missing_inventory_cost_count: z.number().nullable(),
  }),
  inventory: z.object({
    low_stock_count: z.number().nullable(),
    out_of_stock_count: z.number().nullable(),
    negative_stock_count: z.number().nullable(),
  }),
  operations: z.object({
    active_register_count: z.number().nullable(),
    open_register_count: z.number().nullable(),
    active_shift_count: z.number().nullable(),
    clocked_in_employee_count: z.number().nullable(),
    pending_approval_count: z.number().nullable(),
    sync_issue_count: z.number().nullable(),
    pending_sync_count: z.number().nullable(),
    devices_not_seen_recently_count: z.number().nullable(),
    open_ticket_count: z.number().nullable(),
    sales_today_count: z.number(),
  }),
  people: z.object({
    active_employee_count: z.number().nullable(),
    linked_customers_served: z.number().nullable(),
    new_customer_count: z.number().nullable(),
    returning_customer_count: z.number().nullable(),
  }),
  store_performance: z.array(z.object({
    store_id: z.string().uuid(),
    name: z.string(),
    transaction_count: z.number(),
    net_sales_minor: z.number(),
    average_order_minor: z.number(),
  })),
});

export type DashboardOperationalSnapshot = z.infer<typeof dashboardOperationalSnapshotSchema>;

export async function loadDashboardOperationalSnapshot(
  context: BusinessContext,
  filter: ReportFilter,
): Promise<DashboardOperationalSnapshot> {
  const supabase = await createClient();
  const database = supabase as unknown as {
    rpc: (name: "get_dashboard_operational_snapshot", args: Record<string, unknown>) => Promise<{
      data: Json | null;
      error: { message: string } | null;
    }>;
  };
  const { data, error } = await database.rpc("get_dashboard_operational_snapshot", {
    target_organization_id: context.organization.id,
    target_start_date: filter.startDate,
    target_end_date: filter.endDate,
    ...(filter.storeId ? { target_store_id: filter.storeId } : {}),
  });

  if (error || !data) {
    throw new Error(`Unable to load dashboard operations: ${error?.message ?? "No data returned"}`);
  }

  return dashboardOperationalSnapshotSchema.parse(data);
}

/**
 * Reads existing operational records rather than persisting a second
 * onboarding state. The guide is deliberately limited to people who can
 * reach its destinations.
 */
export async function loadBeginnerSetupItems(
  context: BusinessContext,
): Promise<BeginnerSetupItem[] | null> {
  if (!hasAnyPermission(context, ["organization.manage", "settings.manage", "stores.manage"])) {
    return null;
  }

  const supabase = await createClient();
  const organizationId = context.organization.id;
  const readiness = await (supabase as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: Json | null; error: { code?: string; message: string } | null }>;
  }).rpc("get_dashboard_readiness_snapshot_v1", {
    target_organization_id: organizationId,
    include_inventory: context.features.inventory,
  });

  if (readiness.error || !readiness.data || Array.isArray(readiness.data) || typeof readiness.data !== "object") {
    console.error("Unable to load Back Office setup progress", { organizationId, error: readiness.error?.code });
    return null;
  }

  const count = (key: string) => {
    const value = (readiness.data as Record<string, unknown>)[key];
    return typeof value === "number" ? value : 0;
  };
  const stores = count("stores");
  const products = count("products");
  const paymentMethods = count("paymentMethods");
  const stockLevels = count("inventoryLevels");
  const employees = count("employees");
  const registers = count("registers");

  const items: BeginnerSetupItem[] = [];
  if (hasAnyPermission(context, ["organization.manage", "settings.manage"])) {
    items.push({ complete: context.organization.name.trim().length > 0, description: "Review your business name, receipt details, and enabled features.", href: "/back-office/business-profile", label: "Review business information" });
  }
  if (hasPermission(context, "stores.manage")) {
    items.push({ complete: stores > 0, description: "Create the location where you will sell and manage stock.", href: "/back-office/stores", label: "Create your first store" });
  }
  if (hasPermission(context, "products.manage")) {
    items.push({ complete: products > 0, description: "Add something you can sell in the POS.", href: "/back-office/catalog", label: "Add your first product" });
  }
  if (hasPermission(context, "settings.manage")) {
    items.push({ complete: paymentMethods > 0, description: "Check the ways customers can pay at each store.", href: "/back-office/payment-methods", label: "Configure payment methods" });
  }
  if (context.features.inventory && hasPermission(context, "inventory.manage")) {
    items.push({ complete: stockLevels > 0, description: "Record the quantity you have before selling tracked items.", href: "/back-office/inventory?tab=stock", label: "Set opening stock" });
  }
  if (hasPermission(context, "employees.manage")) {
    items.push({ complete: employees > 1, description: "Invite a teammate and choose their access and stores.", href: "/back-office/employees", label: "Add an employee" });
  }
  if (hasPermission(context, "registers.manage")) {
    items.push({ complete: registers > 0, description: "Prepare a selling station for a cashier and shift.", href: "/back-office/registers", label: "Prepare your first register" });
  }

  return items;
}
