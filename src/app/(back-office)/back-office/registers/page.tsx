import { MonitorSmartphone, Store } from "lucide-react";
import { notFound } from "next/navigation";

import { BackOfficeStateCard } from "@/components/back-office/back-office-state-card";
import { GlobalFilterBar } from "@/components/back-office/global-filter-bar";
import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateRegisterForm, EditRegisterButton } from "@/features/management/management-forms";
import { CustomerDisplayManager } from "@/features/customer-display/customer-display-manager";
import { loadManagementRegisters } from "@/features/management/data";
import {
  loadAuthorizedBackOfficeStores,
  resolveBackOfficeStoreScope,
} from "@/lib/server/back-office-store-scope";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";

export const metadata = { title: "Registers" };

export default async function RegistersPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const context = await requireBackOfficePermission("registers.manage");
  const parameters = await searchParams;
  const storeScope = resolveBackOfficeStoreScope(context, parameters);
  if (storeScope.invalidSelection) notFound();
  const { registers, stores: storeRows, displaySessions } = await loadManagementRegisters(context, {
    includeDisplaySessions:
      hasPermission(context, "registers.manage") && context.features.customer_display,
  });

  const stores = new Map(storeRows.map((store) => [store.id, store.name]));
  const canManage = hasPermission(context, "registers.manage");
  const authorizedStores = await loadAuthorizedBackOfficeStores(context);
  const activeStores = storeRows
    .filter((store) => store.is_active)
    .map((store) => ({ id: store.id, name: store.name }));
  const visibleRegisters = storeScope.selectedStoreId
    ? registers.filter((register) => register.store_id === storeScope.selectedStoreId)
    : registers;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Management"
        title="Registers"
        description="Set up each selling station your team uses. A register belongs to one store and is used to open shifts and record sales."
        action={canManage && activeStores.length > 0 ? <CreateRegisterForm stores={activeStores} /> : undefined}
      />
      <GlobalFilterBar action="/back-office/registers" namePrefix="register-filter" showDateRange={false} storeId={storeScope.selectedStoreId} stores={authorizedStores} />

      {canManage && context.features.customer_display && visibleRegisters.length > 0 ? (
        <CustomerDisplayManager
          registers={visibleRegisters.map((register) => ({
            id: register.id,
            name: register.name,
            code: register.code,
            storeName: stores.get(register.store_id) ?? "Unknown store",
          }))}
          sessions={displaySessions.map((session) => ({
            registerId: session.register_id,
            createdAt: session.created_at,
            lastPublishedAt: session.last_published_at,
          }))}
        />
      ) : null}

      {visibleRegisters.length > 0 ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleRegisters.map((register) => (
          <Card key={register.id}>
            <CardHeader className="flex-row items-start justify-between">
              <span className="grid size-10 place-items-center rounded-lg bg-secondary text-primary">
                <MonitorSmartphone className="size-5" aria-hidden="true" />
              </span>
              <Badge variant={register.is_active ? "secondary" : "outline"}>
                {register.is_active ? "Active" : "Inactive"}
              </Badge>
            </CardHeader>
            <CardContent>
              <CardTitle>{register.name}</CardTitle>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {register.code}
              </p>
              <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
                <Store className="size-4" aria-hidden="true" />
                {stores.get(register.store_id) ?? "Unknown store"}
              </p>
              {canManage ? (
                <div className="mt-4 flex justify-end border-t pt-3">
                  <EditRegisterButton
                    register={{
                      id: register.id,
                      name: register.name,
                      code: register.code,
                      storeName: stores.get(register.store_id) ?? "Unknown store",
                      isActive: register.is_active,
                    }}
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>
          ))}
        </section>
      ) : (
        <BackOfficeStateCard
          action={canManage && activeStores.length > 0 ? <CreateRegisterForm stores={activeStores} /> : null}
          description="Create a register in an active store before employees can open a shift and use the POS."
          icon={<MonitorSmartphone className="size-5" aria-hidden="true" />}
          title="No registers yet"
        />
      )}
    </div>
  );
}
