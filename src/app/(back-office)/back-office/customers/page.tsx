import { UsersRound } from "lucide-react";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomerDirectory } from "@/features/customers/customer-directory";
import { CreateCustomerForm, CustomerSegmentForm, LoyaltyProgramForm } from "@/features/customers/customer-forms";
import { loadCustomersOverview } from "@/features/customers/data";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";

export const metadata = { title: "Customers" };

export default async function CustomersPage() {
  const context = await requireBusinessContext();
  const canManageCustomers = hasPermission(context, "customers.manage");
  const canManageSettings = hasPermission(context, "settings.manage");

  if (!canManageCustomers) {
    return (
      <div className="space-y-8">
        <PageHeader
          action={<Badge variant="outline">No CRM access</Badge>}
          description="Customer records and loyalty histories are available to authorized managers."
          eyebrow="CRM"
          title="Customers"
        />
        <Card>
          <CardHeader>
            <CardTitle>Customer management permission required</CardTitle>
            <CardDescription>Ask an owner to assign the customers.manage permission to your role.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const overview = await loadCustomersOverview(context);
  const customers = overview.customers;

  return (
    <div className="space-y-8">
      <PageHeader
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant="secondary"><UsersRound aria-hidden="true" />{customers.length} customers</Badge>
            <CreateCustomerForm />
          </div>
        }
        description="Build customer profiles, review loyalty balances, and trace each customer’s completed purchases."
        eyebrow="CRM"
        title="Customers & loyalty"
      />

      <CustomerSegmentForm segments={overview.segments} />

      {canManageSettings && overview.program ? <LoyaltyProgramForm program={overview.program} /> : null}

      {customers.length > 0 ? (
        <CustomerDirectory customers={customers} />
      ) : (
        <Card>
          <CardHeader className="items-center py-12 text-center">
            <UsersRound className="size-9 text-muted-foreground" aria-hidden="true" />
            <CardTitle>No customers yet</CardTitle>
            <CardDescription>Add a customer here, then select them from the POS cart before checkout.</CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
