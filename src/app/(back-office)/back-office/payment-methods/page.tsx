import { PageHeader } from "@/components/back-office/page-header";
import { CreatePaymentMethodDialog, PaymentMethodsManager } from "@/features/payments/payment-methods-manager";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Payment Methods" };

export default async function PaymentMethodsPage() {
  const context = await requireBackOfficePermission("settings.manage");
  const supabase = await createClient();
  const [methodResult, storeResult, availabilityResult] = await Promise.all([
    supabase
      .from("payment_methods")
      .select("id, name, code, payment_type, offline_policy, is_enabled, requires_reference, sort_order")
      .eq("organization_id", context.organization.id)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("stores")
      .select("id, name, is_active")
      .eq("organization_id", context.organization.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("store_payment_methods")
      .select("store_id, payment_method_id, is_enabled")
      .eq("organization_id", context.organization.id),
  ]);

  const error = [methodResult, storeResult, availabilityResult].find((result) => result.error)?.error;
  if (error) throw new Error(`Unable to load payment methods: ${error.message}`);

  const availabilityByMethod = new Map<string, Array<{ storeId: string; isEnabled: boolean }>>();
  for (const availability of availabilityResult.data ?? []) {
    const items = availabilityByMethod.get(availability.payment_method_id) ?? [];
    items.push({ storeId: availability.store_id, isEnabled: availability.is_enabled });
    availabilityByMethod.set(availability.payment_method_id, items);
  }

  const methods = (methodResult.data ?? []).map((method) => ({
    id: method.id,
    name: method.name,
    code: method.code,
    paymentType: method.payment_type as
      | "CASH"
      | "CARD"
      | "E_WALLET"
      | "BANK_TRANSFER"
      | "VOUCHER"
      | "OTHER",
    offlinePolicy: method.offline_policy as "disabled" | "cash" | "manual_external",
    isEnabled: method.is_enabled,
    requiresReference: method.requires_reference,
    sortOrder: method.sort_order,
    availability: availabilityByMethod.get(method.id) ?? [],
  }));
  const stores = (storeResult.data ?? []).map((store) => ({
    id: store.id,
    name: store.name,
    isActive: store.is_active,
  }));
  const canManage = hasPermission(context, "settings.manage");

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Settings"
        title="Payment Methods"
        description="Choose how customers can pay in the POS, then select the stores that accept each method. Past sales and reports stay unchanged."
        action={
          canManage ? <CreatePaymentMethodDialog stores={stores.filter((store) => store.isActive)} /> : undefined
        }
      />
      <PaymentMethodsManager canManage={canManage} methods={methods} stores={stores} />
    </div>
  );
}
