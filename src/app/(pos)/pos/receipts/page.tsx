import { connection } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ReceiptText } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { loadPosReceiptHistory, loadPosWorkspace } from "@/features/pos/data";
import { PosReceiptHistory } from "@/features/pos/pos-receipt-history";
import { PosReceiptSearch } from "@/features/pos/pos-receipt-search";
import { PosWorkspaceHeader } from "@/features/pos/pos-workspace-header";
import { canAccessBackOffice, getPosNavigationCapabilities, getWorkspaceHome, hasPermission, hasStoreAccess, requireBusinessContext } from "@/lib/auth/dal";
import { cn } from "@/lib/utils";

export const metadata = { title: "POS receipts" };

export default async function PosReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; q?: string }>;
}) {
  await connection();
  const context = await requireBusinessContext();
  if (!hasPermission(context, "pos.access") || !hasPermission(context, "sales.create") || !hasPermission(context, "receipts.view")) redirect(getWorkspaceHome(context));

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
  const canIssueRefund = hasPermission(context, "sales.refund");
  const canRequestRefund = hasPermission(context, "approvals.request");
  const canAuthorizeRefund = hasPermission(context, "approvals.authorize");
  const canReprintReceipts = hasPermission(context, "receipts.reprint");
  const nextBefore = hasMore ? receipts.at(-1)?.receipt_number : undefined;
  const pageQuery = new URLSearchParams();
  if (query) pageQuery.set("q", query);
  if (nextBefore) pageQuery.set("before", String(nextBefore));

  return (
    <main className="min-h-svh bg-background lg:grid lg:h-svh lg:grid-rows-[auto_1fr] lg:overflow-hidden">
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
      <section className="mx-auto flex min-h-0 w-full max-w-6xl flex-col gap-4 p-4 sm:p-6 lg:h-full lg:p-6">
        <div className="grid shrink-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)] sm:items-end">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">POS history</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">Receipts</h1>
          </div>
          <PosReceiptSearch initialQuery={query} key={query} />
        </div>

        {receipts.length > 0 ? (
          <PosReceiptHistory
            receipts={receipts.map((receipt) => ({
              ...receipt,
              canReprint: canReprintReceipts,
              canRefund: (canIssueRefund || canRequestRefund) && hasStoreAccess(context, receipt.store_id),
            }))}
            paymentMethods={workspace.paymentMethods}
            showEmployeeContext={canIssueRefund || canAuthorizeRefund}
            timezone={context.organization.timezone}
          />
        ) : (
          <Card>
            <CardContent className="grid min-h-48 place-items-center p-6 text-center">
              <div>
                <ReceiptText className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
                <p className="mt-3 font-medium">{query ? "No receipt found" : "No receipts yet."}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {query ? `We couldn't find a receipt matching “${query}”.` : "Completed sales will appear here."}
                </p>
                {query ? <Link className={cn(buttonVariants({ className: "mt-4", variant: "outline" }))} href="/pos/receipts">Clear search</Link> : null}
              </div>
            </CardContent>
          </Card>
        )}

        {nextBefore ? (
          <div className="flex shrink-0 justify-center">
            <Link className={cn(buttonVariants({ variant: "outline" }))} href={`/pos/receipts?${pageQuery.toString()}`}>
              Load earlier receipts
            </Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
