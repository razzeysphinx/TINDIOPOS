export type OrganizationUsageSnapshot = {
  usage_date: string;
  active_store_count: number;
  active_employee_count: number;
  active_product_count: number;
  customer_count: number;
  completed_sale_count: number;
  completed_sales_total_minor: number;
  pending_offline_sync_count: number;
  captured_at: string;
};

export type OrganizationReadinessActionResult =
  | { ok: true; message: string; status?: "active" | "suspended" | "archived" }
  | { ok: false; message: string; retryAfterSeconds?: number };

export type OrganizationUsageResult =
  | { ok: true; usage: OrganizationUsageSnapshot }
  | { ok: false; message: string };
