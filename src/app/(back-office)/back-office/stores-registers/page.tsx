import { Store } from "lucide-react";

import { BackOfficeStateCard } from "@/components/back-office/back-office-state-card";
import { PageHeader } from "@/components/back-office/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CreateRegisterForm, CreateStoreForm } from "@/features/management/management-forms";
import { loadManagementStoreRegisterOverview } from "@/features/management/data";
import { StoresRegisterOverview } from "@/features/management/stores-registers-overview";
import { hasAnyPermission, hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";

export const metadata = { title: "Stores & Registers" };

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export default async function StoresRegistersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const context = await requireBackOfficePermission(["stores.manage", "registers.manage"]);
  const parameters = await searchParams;
  const overview = await loadManagementStoreRegisterOverview(context);
  const canManageStores = hasPermission(context, "stores.manage");
  const canManageRegisters = hasPermission(context, "registers.manage");
  const canViewShiftHistory = hasAnyPermission(context, ["shifts.view_history", "settings.manage"]);
  const activeStores = overview
    .filter((store) => store.isActive)
    .map((store) => ({ id: store.id, name: store.name }));
  const query = parameters.q?.trim().toLocaleLowerCase() ?? "";
  const status = parameters.status === "inactive" ? "inactive" : parameters.status === "active" ? "active" : "all";
  const visibleStores = overview.filter((store) => (
    (status === "all" || (status === "active" ? store.isActive : !store.isActive))
    && (!query || [store.name, store.code, store.address ?? ""]
      .some((value) => value.toLocaleLowerCase().includes(query)))
  ));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Management"
        title="Stores & Registers"
        description="Start with a store, then review the selling stations that belong to it. Shift and cash details remain available only where your access allows."
        action={(
          <div className="flex flex-wrap gap-2">
            {canManageStores ? <CreateStoreForm /> : null}
            {canManageRegisters && activeStores.length > 0 ? <CreateRegisterForm stores={activeStores} /> : null}
          </div>
        )}
      />

      <section aria-label="Store filters" className="rounded-xl border bg-card p-4">
        <form action="/back-office/stores-registers" className="grid gap-3 sm:grid-cols-[minmax(0,18rem)_10rem_auto] sm:items-end" method="get">
          <label className="grid gap-1.5 text-sm font-medium">
            Search stores
            <Input defaultValue={parameters.q} name="q" placeholder="Name, code, or address" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Status
            <select className={selectClassName} defaultValue={status} name="status">
              <option value="all">All stores</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <Button className="w-full sm:w-auto" type="submit">Apply</Button>
        </form>
      </section>

      {visibleStores.length > 0 ? (
        <StoresRegisterOverview
          canManageStores={canManageStores}
          canManageRegisters={canManageRegisters}
          canViewShiftHistory={canViewShiftHistory}
          currencyCode={context.organization.currency_code}
          stores={visibleStores}
          timezone={context.organization.timezone}
        />
      ) : (
        <BackOfficeStateCard
          action={canManageStores ? <CreateStoreForm /> : canManageRegisters && activeStores.length > 0 ? <CreateRegisterForm stores={activeStores} /> : null}
          description={query || status !== "all" ? "Try a different search or status filter." : "Create the first active location before setting up its registers and selling stations."}
          icon={<Store className="size-5" aria-hidden="true" />}
          title={query || status !== "all" ? "No matching stores" : "No stores yet"}
        />
      )}
    </div>
  );
}
