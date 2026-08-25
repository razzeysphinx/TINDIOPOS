import { redirect } from "next/navigation";
import { connection } from "next/server";

import { loadKitchenWorkspace } from "@/features/kitchen/data";
import { KitchenDisplay } from "@/features/kitchen/kitchen-display";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";

export const metadata = { title: "Kitchen display" };

export default async function KitchenPage() {
  await connection();
  const context = await requireBusinessContext();
  if (!context.features.kitchen_display) redirect("/back-office");
  const canView = hasPermission(context, "kitchen.view") || hasPermission(context, "kitchen.manage");
  if (!canView) redirect("/back-office");

  const workspace = await loadKitchenWorkspace(context);

  return (
    <KitchenDisplay
      canManage={hasPermission(context, "kitchen.manage")}
      orders={workspace.orders}
      organizationId={context.organization.id}
      stationRoutes={workspace.stationRoutes}
      stores={workspace.stores}
    />
  );
}
