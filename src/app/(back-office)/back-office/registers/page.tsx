import { MonitorSmartphone, Store } from "lucide-react";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateRegisterForm } from "@/features/management/management-forms";
import { CustomerDisplayManager } from "@/features/customer-display/customer-display-manager";
import { loadManagementRegisters } from "@/features/management/data";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";

export const metadata = { title: "Registers" };

export default async function RegistersPage() {
  const context = await requireBusinessContext();
  const { registers, stores: storeRows, displaySessions } = await loadManagementRegisters(context, {
    includeDisplaySessions:
      hasPermission(context, "registers.manage") && context.features.customer_display,
  });

  const stores = new Map(storeRows.map((store) => [store.id, store.name]));
  const canManage = hasPermission(context, "registers.manage");
  const activeStores = storeRows
    .filter((store) => store.is_active)
    .map((store) => ({ id: store.id, name: store.name }));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Management"
        title="Registers"
        description="Every physical or virtual checkout station belongs to one store and carries its own stable code."
        action={
          <Badge variant={canManage ? "secondary" : "outline"}>
            {canManage ? "Management access" : "View access"}
          </Badge>
        }
      />

      {canManage && activeStores.length > 0 ? (
        <CreateRegisterForm stores={activeStores} />
      ) : null}

      {canManage && context.features.customer_display && registers.length > 0 ? (
        <CustomerDisplayManager
          registers={registers.map((register) => ({
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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {registers.map((register) => (
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
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
