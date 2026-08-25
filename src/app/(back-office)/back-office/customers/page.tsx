import { ArrowUpRight, Star, UsersRound } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateCustomerForm, CustomerSegmentForm, LoyaltyProgramForm } from "@/features/customers/customer-forms";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

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

  const supabase = await createClient();
  const [customersResult, transactionsResult, programResult, segmentsResult] = await Promise.all([
    supabase
      .from("customers")
      .select("id, customer_number, loyalty_card_code, full_name, email, phone, status, created_at")
      .eq("organization_id", context.organization.id)
      .order("full_name", { ascending: true })
      .limit(100),
    supabase
      .from("loyalty_transactions")
      .select("customer_id, points_delta")
      .eq("organization_id", context.organization.id),
    supabase
      .from("loyalty_programs")
      .select("is_enabled, earn_spend_minor, earn_points, redemption_value_minor, minimum_redemption_points")
      .eq("organization_id", context.organization.id)
      .maybeSingle(),
    supabase
      .from("customer_segments")
      .select("id, name, description")
      .eq("organization_id", context.organization.id)
      .order("name", { ascending: true }),
  ]);

  const error = [customersResult, transactionsResult, programResult, segmentsResult].find((result) => result.error)?.error;
  if (error) throw new Error(`Unable to load customers: ${error.message}`);

  const pointBalanceByCustomer = new Map<string, number>();
  for (const transaction of transactionsResult.data ?? []) {
    pointBalanceByCustomer.set(
      transaction.customer_id,
      (pointBalanceByCustomer.get(transaction.customer_id) ?? 0) + transaction.points_delta,
    );
  }
  const customers = customersResult.data ?? [];
  const program = programResult.data;
  const segments = segmentsResult.data ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        action={<Badge variant="secondary"><UsersRound aria-hidden="true" />{customers.length} customers</Badge>}
        description="Build customer profiles, review loyalty balances, and trace each customer’s completed purchases."
        eyebrow="CRM"
        title="Customers & loyalty"
      />

      <CreateCustomerForm />

      <CustomerSegmentForm segments={segments} />

      {canManageSettings && program ? (
        <LoyaltyProgramForm
          program={{
            isEnabled: program.is_enabled,
            earnSpendMinor: program.earn_spend_minor,
            earnPoints: program.earn_points,
            redemptionValueMinor: program.redemption_value_minor,
            minimumRedemptionPoints: program.minimum_redemption_points,
          }}
        />
      ) : null}

      {customers.length > 0 ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Customer profiles">
          {customers.map((customer) => {
            const points = pointBalanceByCustomer.get(customer.id) ?? 0;
            return (
              <Link href={`/back-office/customers/${customer.id}`} key={customer.id}>
                <Card className="h-full transition-colors hover:bg-muted/30">
                  <CardHeader className="flex-row items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{customer.full_name}</CardTitle>
                      <CardDescription className="mt-1 truncate">
                        #{customer.customer_number.toLocaleString()} Â· {customer.phone ?? customer.email ?? customer.loyalty_card_code}
                      </CardDescription>
                    </div>
                    <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </CardHeader>
                  <CardContent className="flex items-center justify-between gap-3">
                    <Badge variant={customer.status === "active" ? "secondary" : "outline"}>
                      {customer.status === "active" ? "Active" : "Archived"}
                    </Badge>
                    <span className="flex items-center gap-1 text-sm font-semibold text-primary">
                      <Star className="size-4" aria-hidden="true" />
                      {points.toLocaleString()} pts
                    </span>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </section>
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
