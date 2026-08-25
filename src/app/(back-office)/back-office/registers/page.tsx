import { MonitorSmartphone, Store } from "lucide-react";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateRegisterForm } from "@/features/management/management-forms";
import { CustomerDisplayManager } from "@/features/customer-display/customer-display-manager";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Registers" };

export default async function RegistersPage() {
  const context = await requireBusinessContext();
  const supabase = await createClient();
  const [registerResult, storeResult, displaySessionsResult] = await Promise.all([
    supabase
      .from("registers")
      .select("id, store_id, name, code, is_active, created_at")
      .eq("organization_id", context.organization.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("stores")
      .select("id, name, is_active")
      .eq("organization_id", context.organization.id),
    hasPermission(context, "registers.manage") && context.features.customer_display
      ? supabase.rpc("get_customer_display_management_sessions", {
          target_organization_id: context.organization.id,
        })
      : Promise.resolve({
          data: [] as Array<{
            register_id: string;
            created_at: string;
            last_published_at: string | null;
          }>,
          error: null,
        }),
  ]);

  if (registerResult.error || storeResult.error || displaySessionsResult.error) {
    throw new Error(
      `Unable to load registers: ${registerResult.error?.message ?? storeResult.error?.message ?? displaySessionsResult.error?.message}`,
    );
  }

  const stores = new Map(storeResult.data.map((store) => [store.id, store.name]));
  const canManage = hasPermission(context, "registers.manage");
  const activeStores = storeResult.data
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

      {canManage && context.features.customer_display && registerResult.data.length > 0 ? (
        <CustomerDisplayManager
          registers={registerResult.data.map((register) => ({
            id: register.id,
            name: register.name,
            code: register.code,
            storeName: stores.get(register.store_id) ?? "Unknown store",
          }))}
          sessions={(displaySessionsResult.data ?? []).map((session) => ({
            registerId: session.register_id,
            createdAt: session.created_at,
            lastPublishedAt: session.last_published_at,
          }))}
        />
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {registerResult.data.map((register) => (
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
