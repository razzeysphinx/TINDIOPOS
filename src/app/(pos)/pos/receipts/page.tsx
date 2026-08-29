import { connection } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ReceiptText, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import { loadPosReceiptHistory, loadPosWorkspace } from "@/features/pos/data";
import { PosWorkspaceHeader } from "@/features/pos/pos-workspace-header";
import { canAccessBackOffice, getPosNavigationCapabilities, getWorkspaceHome, hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { cn } from "@/lib/utils";

export const metadata = { title: "POS receipts" };

function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export default async function PosReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; q?: string }>;
}) {
  await connection();
  const context = await requireBusinessContext();
  if (!hasPermission(context, "pos.access") || !hasPermission(context, "receipts.view")) redirect(getWorkspaceHome(context));

  const parameters = await searchParams;
  const query = parameters.q?.trim().slice(0, 100) ?? "";
  const parsedBefore = Number(parameters.before);
  const beforeReceiptNumber = Number.isSafeInteger(parsedBefore) && parsedBefore > 0
    ? parsedBefore
    : undefined;
  const [workspace, receipts] = await Promise.all([
    loadPosWorkspace(context),
    loadPosReceiptHistory(context, { beforeReceiptNumber, query }),
  ]);
  const hasMore = receipts.length === 25;
  const nextBefore = hasMore ? receipts.at(-1)?.receipt_number : undefined;
  const pageQuery = new URLSearchParams();
  if (query) pageQuery.set("q", query);
  if (nextBefore) pageQuery.set("before", String(nextBefore));

  return (
    <main className="min-h-svh bg-background">
      <PosWorkspaceHeader
        canAccessBackOffice={canAccessBackOffice(context)}
        {...getPosNavigationCapabilities(context)}
        canUseTimeClock={context.features.time_clock}
        employeeName={context.profile.full_name || context.profile.email || "Cashier"}
        organizationName={context.organization.name}
        scope={`${context.organization.id}:${context.user.id}`}
        stores={workspace.stores}
        timeClockEntry={workspace.timeClockEntry}
        timezone={context.organization.timezone}
        title="Receipts"
      />
      <section className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6 lg:p-8">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">POS history</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">Receipts</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your completed sales are shown here. Managers with refund access can also review receipts in their assigned stores.
          </p>
        </div>

        <form className="flex flex-col gap-2 sm:flex-row" method="get">
          <label className="sr-only" htmlFor="pos-receipt-search">Search receipts</label>
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-10 pl-9" defaultValue={query} id="pos-receipt-search" name="q" placeholder="Receipt number, store, register, or cashier" />
          </div>
          <Button type="submit" variant="outline">Search</Button>
        </form>

        {receipts.length > 0 ? (
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {receipts.map((receipt) => (
                  <Link
                    className="grid gap-2 px-4 py-4 transition-colors hover:bg-muted/40 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-center sm:px-5"
                    href={`/pos/receipts/${receipt.receipt_id}`}
                    key={receipt.receipt_id}
                  >
                    <span className="font-semibold">#{receipt.receipt_number}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{receipt.store_name} · {receipt.register_name}</span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">{receipt.cashier_name} · {formatDate(receipt.issued_at, context.organization.timezone)}</span>
                    </span>
                    <span className="flex items-center gap-2 sm:justify-end">
                      {receipt.refund_total_minor > 0 ? <Badge variant="outline">Refunded</Badge> : null}
                      <span className="font-semibold">{formatMinorMoney(receipt.total_minor, receipt.currency_code)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="grid min-h-48 place-items-center p-6 text-center">
              <div>
                <ReceiptText className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
                <p className="mt-3 font-medium">No matching POS receipts</p>
                <p className="mt-1 text-sm text-muted-foreground">Completed receipts in your permitted store scope will appear here.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {nextBefore ? (
          <div className="flex justify-center">
            <Link className={cn(buttonVariants({ variant: "outline" }))} href={`/pos/receipts?${pageQuery.toString()}`}>
              Load earlier receipts
            </Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
