import { MapPin, Phone, Store } from "lucide-react";

import { BackOfficeStateCard } from "@/components/back-office/back-office-state-card";
import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateStoreForm, EditStoreButton } from "@/features/management/management-forms";
import { loadManagementStores } from "@/features/management/data";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";

export const metadata = { title: "Stores" };

export default async function StoresPage() {
  const context = await requireBackOfficePermission("stores.manage");
  const stores = await loadManagementStores(context);

  const canManage = hasPermission(context, "stores.manage");

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Management"
        title="Stores"
        description="Manage the places where you sell. Each store can have its own registers, team access, and stock."
        action={canManage && context.features.multi_store ? <CreateStoreForm /> : undefined}
      />

      {canManage && !context.features.multi_store ? (
        <Card>
          <CardHeader>
            <CardTitle>Multi-store is disabled</CardTitle>
            <p className="text-sm text-muted-foreground">
              Enable Multi-store in Business Profile before adding another location.
            </p>
          </CardHeader>
        </Card>
      ) : null}

      {stores.length > 0 ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {stores.map((store) => (
          <Card key={store.id}>
            <CardHeader className="flex-row items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-lg bg-secondary text-primary">
                  <Store className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <CardTitle>{store.name}</CardTitle>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {store.code}
                  </p>
                </div>
              </div>
              <Badge variant={store.is_active ? "secondary" : "outline"}>
                {store.is_active ? "Active" : "Inactive"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {store.address || "No address added"}
              </p>
              <p className="flex items-center gap-2">
                <Phone className="size-4 shrink-0" aria-hidden="true" />
                {store.phone || "No phone added"}
              </p>
              {canManage ? (
                <div className="flex justify-end border-t pt-3">
                  <EditStoreButton
                    store={{
                      id: store.id,
                      name: store.name,
                      code: store.code,
                      address: store.address,
                      phone: store.phone,
                      isActive: store.is_active,
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
          action={canManage && context.features.multi_store ? <CreateStoreForm /> : null}
          description="Create the first active location before adding registers, assigning employees, or selling from the POS."
          icon={<Store className="size-5" aria-hidden="true" />}
          title="No stores yet"
        />
      )}
    </div>
  );
}
