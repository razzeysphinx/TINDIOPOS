import { UsersRound } from "lucide-react";

import { BackOfficeStateCard } from "@/components/back-office/back-office-state-card";
import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { CustomerDirectory } from "@/features/customers/customer-directory";
import { CustomerCsvTools } from "@/features/customers/customer-csv-tools";
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
        <BackOfficeStateCard
          description="Ask an owner to assign the customers.manage permission to your role."
          icon={<UsersRound className="size-5" aria-hidden="true" />}
          title="Customer management permission required"
        />
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

      <CustomerCsvTools />

      {canManageSettings && overview.program ? <LoyaltyProgramForm program={overview.program} /> : null}

      {customers.length > 0 ? (
        <CustomerDirectory customers={customers} />
      ) : (
        <BackOfficeStateCard
          description="Add a customer here, then select them from the POS cart before checkout."
          icon={<UsersRound className="size-5" aria-hidden="true" />}
          title="No customers yet"
        />
      )}
    </div>
  );
}
