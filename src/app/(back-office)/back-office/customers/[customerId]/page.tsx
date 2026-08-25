import { ArrowLeft, CalendarClock, ReceiptText, Star } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import { CustomerProfileForm, CustomerStatusButton, LoyaltyAdjustmentForm } from "@/features/customers/customer-forms";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Customer profile" };

function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  const context = await requireBusinessContext();
  if (!hasPermission(context, "customers.manage")) notFound();

  const supabase = await createClient();
  const [customerResult, summaryResult, historyResult, transactionsResult, segmentsResult, membershipsResult] = await Promise.all([
    supabase
      .from("customers")
      .select("id, customer_number, loyalty_card_code, full_name, email, phone, address, birthday, notes, status, created_at")
      .eq("organization_id", context.organization.id)
      .eq("id", customerId)
      .maybeSingle(),
    supabase.rpc("get_customer_summary", {
      target_organization_id: context.organization.id,
      target_customer_id: customerId,
    }),
    supabase.rpc("get_customer_purchase_history", {
      target_organization_id: context.organization.id,
      target_customer_id: customerId,
      target_limit: 25,
    }),
    supabase
      .from("loyalty_transactions")
      .select("id, entry_type, points_delta, note, created_at")
      .eq("organization_id", context.organization.id)
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("customer_segments")
      .select("id, name, description")
      .eq("organization_id", context.organization.id)
      .order("name", { ascending: true }),
    supabase
      .from("customer_segment_memberships")
      .select("segment_id")
      .eq("organization_id", context.organization.id)
      .eq("customer_id", customerId),
  ]);

  if (!customerResult.data) notFound();
  const error = [summaryResult, historyResult, transactionsResult, segmentsResult, membershipsResult].find((result) => result.error)?.error;
  if (error) throw new Error(`Unable to load customer profile: ${error.message}`);

  const customer = customerResult.data;
  const summary = summaryResult.data?.[0];
  const history = historyResult.data ?? [];
  const transactions = transactionsResult.data ?? [];
  const segments = segmentsResult.data ?? [];
  const selectedSegmentIds = (membershipsResult.data ?? []).map((membership) => membership.segment_id);

  return (
    <div className="space-y-8">
      <Link className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground" href="/back-office/customers">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Customers
      </Link>
      <PageHeader
        action={<Badge variant={customer.status === "active" ? "secondary" : "outline"}>Customer #{customer.customer_number.toLocaleString()} Â· {customer.status}</Badge>}
        description={customer.phone ?? customer.email ?? "No contact details have been recorded."}
        eyebrow="Customer profile"
        title={customer.full_name}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Loyalty balance" value={`${(summary?.loyalty_points ?? 0).toLocaleString()} pts`} icon={<Star />} />
        <Metric label="Purchases" value={(summary?.sale_count ?? 0).toLocaleString()} icon={<ReceiptText />} />
        <Metric label="Lifetime spend" value={formatMinorMoney(summary?.lifetime_spend_minor ?? 0, context.organization.currency_code)} icon={<CalendarClock />} />
        <Metric label="Average sale" value={formatMinorMoney(summary?.average_sale_minor ?? 0, context.organization.currency_code)} icon={<ReceiptText />} />
        <Metric label="Last visit" value={summary?.last_purchase_at ? formatDate(summary.last_purchase_at, context.organization.timezone) : "No visits yet"} icon={<CalendarClock />} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <Card>
          <CardHeader>
            <CardTitle>Customer profile</CardTitle>
            <CardDescription>Customer #{customer.customer_number.toLocaleString()} · Created {formatDate(customer.created_at, context.organization.timezone)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
              <Detail label="Customer ID" value={`#${customer.customer_number.toLocaleString()}`} />
              <Detail label="Current loyalty card" value={customer.loyalty_card_code} />
            </div>
            <CustomerProfileForm
              customer={{
                id: customer.id,
                fullName: customer.full_name,
                email: customer.email,
                phone: customer.phone,
                address: customer.address,
                birthday: customer.birthday,
                notes: customer.notes,
                loyaltyCardCode: customer.loyalty_card_code,
              }}
              segments={segments}
              selectedSegmentIds={selectedSegmentIds}
            />
            <CustomerStatusButton
              customerId={customer.id}
              status={customer.status as "active" | "archived"}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Purchase history</CardTitle>
            <CardDescription>
              {summary?.last_purchase_at ? `Last purchase ${formatDate(summary.last_purchase_at, context.organization.timezone)}` : "No completed sales yet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {history.length > 0 ? (
              <ul className="divide-y">
                {history.map((sale) => (
                  <li className="grid gap-2 px-5 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center" key={sale.sale_id}>
                    <div>
                      <p className="font-medium">{sale.store_name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {sale.receipt_number ? `Receipt #${sale.receipt_number} · ` : ""}
                        {formatDate(sale.completed_at, context.organization.timezone)}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground sm:text-right">
                      {sale.loyalty_points_earned ? `+${sale.loyalty_points_earned} earned` : ""}
                      {sale.loyalty_points_redeemed ? `${sale.loyalty_points_earned ? " · " : ""}${sale.loyalty_points_redeemed} redeemed` : ""}
                    </p>
                    <p className="font-semibold sm:text-right">{formatMinorMoney(sale.total_minor, sale.currency_code)}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="px-5 py-8 text-sm text-muted-foreground">This customer has no completed purchases yet.</p>}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Loyalty ledger</CardTitle>
          <CardDescription>Every balance change is recorded; no manual balance field exists. Adjustments require a reason and are audited.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <LoyaltyAdjustmentForm customerId={customer.id} />
          <div className="-mx-6 divide-y border-t">
            {transactions.length > 0 ? (
              <ul className="divide-y">
                {transactions.map((transaction) => (
                  <li className="flex items-center justify-between gap-4 px-5 py-3 text-sm" key={transaction.id}>
                    <span>
                      <span className="font-medium">{transaction.entry_type.replaceAll("_", " ")}</span>
                      {transaction.note ? <span className="mt-1 block text-xs text-muted-foreground">{transaction.note}</span> : null}
                    </span>
                    <span className={transaction.points_delta > 0 ? "font-semibold text-primary" : "font-semibold text-destructive"}>
                      {transaction.points_delta > 0 ? "+" : ""}{transaction.points_delta.toLocaleString()} pts
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="px-5 py-8 text-sm text-muted-foreground">No loyalty activity has been recorded.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <span className="grid size-9 place-items-center rounded-lg bg-secondary text-primary [&_svg]:size-4">{icon}</span>
      </CardHeader>
      <CardContent>
        <p className="text-xl font-semibold">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-wrap">{value || "—"}</p>
    </div>
  );
}
