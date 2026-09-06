import { ArrowLeft, CalendarClock, ReceiptText, Star } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import { CustomerProfileForm, CustomerStatusButton, LoyaltyAdjustmentForm } from "@/features/customers/customer-forms";
import { loadCustomerProfile } from "@/features/customers/data";
import { LoyaltyCardManager } from "@/features/customers/loyalty-card-manager";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";

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
  const context = await requireBackOfficePermission("customers.manage");
  if (!hasPermission(context, "customers.manage")) notFound();

  const workspace = await loadCustomerProfile(context, customerId);
  if (!workspace) notFound();

  const { customer, summary, history, ledger, loyaltyCards, loyaltyCardEvents, segments, selectedSegmentIds } = workspace;

  return (
    <div className="space-y-8">
      <Link className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground" href="/back-office/customers">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Customers
      </Link>
      <PageHeader
        action={<Badge variant={customer.status === "active" ? "secondary" : "outline"}>Customer #{customer.customerNumber.toLocaleString()} Â· {customer.status}</Badge>}
        description={customer.phone ?? customer.email ?? "No contact details have been recorded."}
        eyebrow="Customer profile"
        showDescription
        showTitle
        title={customer.fullName}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Loyalty balance" value={`${(summary?.loyaltyPoints ?? 0).toLocaleString()} pts`} icon={<Star />} />
        <Metric label="Purchases" value={(summary?.saleCount ?? 0).toLocaleString()} icon={<ReceiptText />} />
        <Metric label="Lifetime spend" value={formatMinorMoney(summary?.lifetimeSpendMinor ?? 0, context.organization.currency_code)} icon={<CalendarClock />} />
        <Metric label="Average sale" value={formatMinorMoney(summary?.averageSaleMinor ?? 0, context.organization.currency_code)} icon={<ReceiptText />} />
        <Metric label="Last visit" value={summary?.lastPurchaseAt ? formatDate(summary.lastPurchaseAt, context.organization.timezone) : "No visits yet"} icon={<CalendarClock />} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <Card>
          <CardHeader>
            <CardTitle>Customer profile</CardTitle>
            <CardDescription>Customer #{customer.customerNumber.toLocaleString()} · Created {formatDate(customer.createdAt, context.organization.timezone)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
              <Detail label="Customer ID" value={`#${customer.customerNumber.toLocaleString()}`} />
              <Detail label="Current loyalty card" value={customer.loyaltyCardCode} />
            </div>
            <CustomerProfileForm
              customer={{
                id: customer.id,
                fullName: customer.fullName,
                email: customer.email,
                phone: customer.phone,
                address: customer.address,
                birthday: customer.birthday,
                notes: customer.notes,
                loyaltyCardCode: customer.loyaltyCardCode,
              }}
              segments={segments}
              selectedSegmentIds={selectedSegmentIds}
            />
            <CustomerStatusButton
              customerId={customer.id}
              status={customer.status}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Purchase history</CardTitle>
            <CardDescription>
              {summary?.lastPurchaseAt ? `Last purchase ${formatDate(summary.lastPurchaseAt, context.organization.timezone)}` : "No completed sales yet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {history.length > 0 ? (
              <ul className="divide-y">
                {history.map((sale) => (
                  <li className="grid gap-2 px-5 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center" key={sale.saleId}>
                    <div>
                      <p className="font-medium">{sale.storeName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {sale.receiptNumber ? `Receipt #${sale.receiptNumber} · ` : ""}
                        {formatDate(sale.completedAt, context.organization.timezone)}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground sm:text-right">
                      {sale.loyaltyPointsEarned ? `+${sale.loyaltyPointsEarned} earned` : ""}
                      {sale.loyaltyPointsRedeemed ? `${sale.loyaltyPointsEarned ? " · " : ""}${sale.loyaltyPointsRedeemed} redeemed` : ""}
                    </p>
                    <p className="font-semibold sm:text-right">{formatMinorMoney(sale.totalMinor, sale.currencyCode)}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="px-5 py-8 text-sm text-muted-foreground">This customer has no completed purchases yet.</p>}
          </CardContent>
        </Card>
      </section>

      <LoyaltyCardManager
        cards={loyaltyCards}
        customerId={customer.id}
        customerName={customer.fullName}
        events={loyaltyCardEvents}
        sales={history.map((sale) => ({
          saleId: sale.saleId,
          receiptNumber: sale.receiptNumber,
          completedAt: sale.completedAt,
          storeName: sale.storeName,
        }))}
      />

      <Card>
        <CardHeader>
          <CardTitle>Loyalty ledger</CardTitle>
          <CardDescription>Every balance change is recorded; no manual balance field exists. Adjustments require a reason and are audited.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <LoyaltyAdjustmentForm customerId={customer.id} />
          <div className="-mx-6 divide-y border-t">
            {ledger.length > 0 ? (
              <ul className="divide-y">
                {ledger.map((transaction) => (
                  <li className="flex items-center justify-between gap-4 px-5 py-3 text-sm" key={transaction.id}>
                    <span>
                      <span className="font-medium">{transaction.entryType.replaceAll("_", " ")}</span>
                      {transaction.note ? <span className="mt-1 block text-xs text-muted-foreground">{transaction.note}</span> : null}
                    </span>
                    <span className={transaction.pointsDelta > 0 ? "font-semibold text-primary" : "font-semibold text-destructive"}>
                      {transaction.pointsDelta > 0 ? "+" : ""}{transaction.pointsDelta.toLocaleString()} pts
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
