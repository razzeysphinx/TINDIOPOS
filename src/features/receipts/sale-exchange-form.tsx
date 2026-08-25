"use client";

import { ArrowRightLeft, LoaderCircle } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import { linkSaleExchangeAction } from "@/features/receipts/improvement-6-actions";

type ExchangeReturn = {
  id: string;
  refundNumber: number;
  totalMinor: number;
  replacementReceiptNumber: number | null;
};

export function SaleExchangeForm({
  currencyCode,
  refunds,
}: {
  currencyCode: string;
  refunds: ExchangeReturn[];
}) {
  const router = useRouter();
  const availableReturns = useMemo(
    () => refunds.filter((refund) => refund.replacementReceiptNumber === null),
    [refunds],
  );
  const [refundId, setRefundId] = useState(availableReturns[0]?.id ?? "");
  const [replacementReceiptNumber, setReplacementReceiptNumber] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <Card className="print:hidden">
      <CardHeader className="flex-row items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground">
          <ArrowRightLeft className="size-5" aria-hidden="true" />
        </span>
        <div>
          <CardTitle>Exchange workflow</CardTitle>
          <CardDescription className="mt-1">
            An exchange is always a completed return plus a separate completed replacement sale. The original sale remains unchanged.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Process the returned item(s) as a refund on this receipt.</li>
          <li>Complete the replacement items as a normal new POS sale.</li>
          <li>Enter the replacement receipt number below to create the audit link.</li>
        </ol>

        {availableReturns.length > 0 ? (
          <form
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              setMessage(null);
              startTransition(async () => {
                const result = await linkSaleExchangeAction({
                  refundId,
                  replacementReceiptNumber: Number(replacementReceiptNumber),
                  idempotencyKey,
                });
                setMessage(result.message);
                if (result.ok) {
                  setIdempotencyKey(crypto.randomUUID());
                  router.refresh();
                }
              });
            }}
          >
            <select
              className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              disabled={isPending}
              onChange={(event) => setRefundId(event.target.value)}
              value={refundId}
            >
              {availableReturns.map((refund) => (
                <option key={refund.id} value={refund.id}>
                  Return #{refund.refundNumber} · {formatMinorMoney(refund.totalMinor, currencyCode)}
                </option>
              ))}
            </select>
            <Input
              disabled={isPending}
              inputMode="numeric"
              min={1}
              onChange={(event) => setReplacementReceiptNumber(event.target.value)}
              placeholder="Receipt #"
              required
              type="number"
              value={replacementReceiptNumber}
            />
            <Button disabled={isPending} type="submit">
              {isPending ? <LoaderCircle className="animate-spin" /> : <ArrowRightLeft />}
              Link exchange
            </Button>
          </form>
        ) : (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            Process a return first. Every completed return on this receipt is already linked to a replacement sale.
          </p>
        )}

        {message ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
        {refunds.some((refund) => refund.replacementReceiptNumber !== null) ? (
          <div className="space-y-2 border-t pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Linked exchanges</p>
            {refunds.filter((refund) => refund.replacementReceiptNumber !== null).map((refund) => (
              <div className="flex items-center justify-between gap-3 text-sm" key={refund.id}>
                <span>Return #{refund.refundNumber}</span>
                <Badge variant="secondary">Replacement #{refund.replacementReceiptNumber}</Badge>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
