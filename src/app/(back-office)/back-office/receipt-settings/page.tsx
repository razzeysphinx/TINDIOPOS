import { PageHeader } from "@/components/back-office/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReceiptSettingsManager } from "@/features/receipts/receipt-settings-manager";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Receipt Settings" };

export default async function ReceiptSettingsPage() {
  const context = await requireBackOfficePermission("settings.manage");
  const canManage = hasPermission(context, "settings.manage");

  if (!canManage) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Settings"
          title="Receipt Settings"
          description="Receipt details can be changed only by people who manage business settings."
        />
        <Card>
          <CardHeader>
            <CardTitle>Receipt settings access is required</CardTitle>
            <CardDescription>Ask an owner or authorized administrator to update these settings.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: settings, error } = await supabase
    .from("receipt_settings")
    .select(
      "business_name, business_address, business_phone, business_email, business_tax_id, business_website, header_message, footer_message, paper_width_mm, show_store_address, show_store_phone, show_cashier, show_register, show_payment_details",
    )
    .eq("organization_id", context.organization.id)
    .maybeSingle();

  if (error) throw new Error(`Unable to load receipt settings: ${error.message}`);
  if (!settings) throw new Error("Receipt settings were not initialized for this organization.");

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Settings"
        title="Receipt Settings"
        description="Choose the business details and print layout used on new receipts. Completed receipts keep the information saved at the time of sale."
      />
      <ReceiptSettingsManager
        canManage={canManage}
        initialSettings={{
          businessName: settings.business_name,
          businessAddress: settings.business_address ?? "",
          businessPhone: settings.business_phone ?? "",
          businessEmail: settings.business_email ?? "",
          businessTaxId: settings.business_tax_id ?? "",
          businessWebsite: settings.business_website ?? "",
          headerMessage: settings.header_message ?? "",
          footerMessage: settings.footer_message,
          paperWidthMm: settings.paper_width_mm as 58 | 80,
          showStoreAddress: settings.show_store_address,
          showStorePhone: settings.show_store_phone,
          showCashier: settings.show_cashier,
          showRegister: settings.show_register,
          showPaymentDetails: settings.show_payment_details,
        }}
      />
    </div>
  );
}
