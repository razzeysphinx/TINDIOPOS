import { UsersRound } from "lucide-react";

import { BackOfficeStateCard } from "@/components/back-office/back-office-state-card";
import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { CustomerDirectory } from "@/features/customers/customer-directory";
import { CustomerCsvTools } from "@/features/customers/customer-csv-tools";
import { CreateCustomerForm, CustomerSegmentForm, LoyaltyProgramForm } from "@/features/customers/customer-forms";
import { loadCustomersOverview } from "@/features/customers/data";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";

export const metadata = { title: "Customers & Loyalty" };

export default async function CustomersPage() {
  const context = await requireBackOfficePermission("customers.manage");
  const canManageCustomers = hasPermission(context, "customers.manage");
  const canManageSettings = hasPermission(context, "settings.manage");

  if (!canManageCustomers) {
    return (
      <div className="space-y-8">
        <PageHeader
          description="Customer records and loyalty histories are available to authorized managers."
          eyebrow="CRM"
          title="Customers & Loyalty"
        />
        <BackOfficeStateCard
          description="Ask an owner or authorized administrator to give your role customer-management access."
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
        description="Keep customer details in one place, manage loyalty, and review completed purchases."
        eyebrow="CRM"
        title="Customers & Loyalty"
      />

      <CustomerSegmentForm segments={overview.segments} />

      <CustomerCsvTools />

      {canManageSettings && overview.program ? <LoyaltyProgramForm program={overview.program} /> : null}

      {customers.length > 0 ? (
        <CustomerDirectory customers={customers} />
      ) : (
        <BackOfficeStateCard
          action={<CreateCustomerForm />}
          description="Add a customer here, then select them from the POS cart before checkout."
          icon={<UsersRound className="size-5" aria-hidden="true" />}
          title="No customers yet"
        />
      )}
    </div>
  );
}
