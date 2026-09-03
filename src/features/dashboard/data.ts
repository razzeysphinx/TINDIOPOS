import "server-only";

import type { BeginnerSetupItem } from "@/features/dashboard/beginner-setup-types";
import { hasAnyPermission, hasPermission, type BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

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
  const [stores, products, paymentMethods, stockLevels, employees, registers] = await Promise.all([
    supabase.from("stores").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("is_active", true),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "active"),
    supabase.from("payment_methods").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("is_enabled", true),
    context.features.inventory
      ? supabase.from("inventory_levels").select("id", { count: "exact", head: true }).eq("organization_id", organizationId)
      : Promise.resolve({ count: 0, error: null }),
    supabase.from("employees").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "active"),
    supabase.from("registers").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("is_active", true),
  ]);

  if ([stores, products, paymentMethods, stockLevels, employees, registers].some((result) => result.error)) {
    // The checklist is supplemental. Do not block the dashboard if a role can
    // see it but cannot read one setup resource through RLS.
    console.error("Unable to load Back Office setup progress", {
      organizationId,
      errors: [stores, products, paymentMethods, stockLevels, employees, registers]
        .map((result) => result.error?.code)
        .filter(Boolean),
    });
    return null;
  }

  const items: BeginnerSetupItem[] = [];
  if (hasAnyPermission(context, ["organization.manage", "settings.manage"])) {
    items.push({ complete: context.organization.name.trim().length > 0, description: "Review your business name, receipt details, and enabled features.", href: "/back-office/business-profile", label: "Review business information" });
  }
  if (hasPermission(context, "stores.manage")) {
    items.push({ complete: (stores.count ?? 0) > 0, description: "Create the location where you will sell and manage stock.", href: "/back-office/stores", label: "Create your first store" });
  }
  if (hasPermission(context, "products.manage")) {
    items.push({ complete: (products.count ?? 0) > 0, description: "Add something you can sell in the POS.", href: "/back-office/catalog", label: "Add your first product" });
  }
  if (hasPermission(context, "settings.manage")) {
    items.push({ complete: (paymentMethods.count ?? 0) > 0, description: "Check the ways customers can pay at each store.", href: "/back-office/payment-methods", label: "Configure payment methods" });
  }
  if (context.features.inventory && hasPermission(context, "inventory.manage")) {
    items.push({ complete: (stockLevels.count ?? 0) > 0, description: "Record the quantity you have before selling tracked items.", href: "/back-office/inventory?tab=stock", label: "Set opening stock" });
  }
  if (hasPermission(context, "employees.manage")) {
    items.push({ complete: (employees.count ?? 0) > 1, description: "Invite a teammate and choose their access and stores.", href: "/back-office/employees", label: "Add an employee" });
  }
  if (hasPermission(context, "registers.manage")) {
    items.push({ complete: (registers.count ?? 0) > 0, description: "Prepare a selling station for a cashier and shift.", href: "/back-office/registers", label: "Prepare your first register" });
  }

  return items;
}
