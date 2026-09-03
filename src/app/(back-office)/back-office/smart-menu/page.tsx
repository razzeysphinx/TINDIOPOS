import { MenuSquare } from "lucide-react";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadSmartMenuWorkspace } from "@/features/smart-menu/data";
import { SmartMenuManager } from "@/features/smart-menu/smart-menu-manager";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";

export const metadata = { title: "Smart Menu" };

export default async function SmartMenuPage() {
  const context = await requireBackOfficePermission("settings.manage");
  const canManage = hasPermission(context, "settings.manage");

  if (!canManage) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Customer menu"
          title="Smart Menu"
          description="A settings manager can configure the customer-facing, view-only menu for each active store."
          action={<Badge variant="outline">No settings access</Badge>}
        />
        <Card>
          <CardHeader>
            <CardTitle>Smart Menu access is required</CardTitle>
            <CardDescription>Ask an owner or authorized administrator to update this customer menu.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const workspace = await loadSmartMenuWorkspace(context);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Customer menu"
        title="Smart Menu"
        description="Publish a view-only customer menu from the current store catalog. Product changes remain managed in Catalog."
        action={<Badge variant="secondary"><MenuSquare aria-hidden="true" /> Settings access</Badge>}
      />
      <SmartMenuManager {...workspace} />
    </div>
  );
}
