"use client";

import { CheckCircle2, ReceiptText, ShoppingBag, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

import { formatMinorMoney } from "@/features/catalog/catalog-money";
import {
  customerDisplayStateSchema,
  type CustomerDisplayState,
} from "@/features/customer-display/customer-display-types";
import { createClient } from "@/lib/supabase/client";

function formatDisplayTime(value: string) {
  return new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  );
}

export function CustomerDisplay({
  businessName,
  storeName,
  registerName,
  realtimeTopic,
  initialState,
  digitalReceiptBaseUrl,
}: {
  businessName: string;
  storeName: string;
  registerName: string;
  realtimeTopic: string;
  initialState: CustomerDisplayState;
  digitalReceiptBaseUrl: string;
}) {
  const [state, setState] = useState(initialState);
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "live" | "offline">("connecting");

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`tindio-customer-display:${realtimeTopic}`)
      .on("broadcast", { event: "display-state" }, ({ payload }) => {
        const parsed = customerDisplayStateSchema.safeParse(payload);
        if (parsed.success) setState(parsed.data);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnectionStatus("live");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConnectionStatus("offline");
        } else {
          setConnectionStatus("connecting");
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [realtimeTopic]);

  const currencyCode = state.currencyCode ?? "PHP";
  const hasItems = state.items.length > 0;
  const isComplete = state.status === "complete";
  const digitalReceiptUrl = isComplete && state.saleId
    ? `${digitalReceiptBaseUrl}/${state.saleId}`
    : null;

  return (
    <main className="min-h-svh bg-muted/35 p-3 sm:p-5 lg:p-7">
      <section className="mx-auto grid min-h-[calc(100svh-1.5rem)] max-w-6xl grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl border bg-background shadow-sm sm:min-h-[calc(100svh-2.5rem)]">
        <header className="flex items-center justify-between gap-4 border-b bg-card px-5 py-4 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <ShoppingBag aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">{businessName}</p>
              <p className="truncate text-sm text-muted-foreground">{storeName} · {registerName}</p>
            </div>
          </div>
          <p className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
            {connectionStatus === "live" ? <Wifi aria-hidden="true" className="size-3.5 text-primary" /> : <WifiOff aria-hidden="true" className="size-3.5" />}
            {connectionStatus === "live" ? "Live" : connectionStatus === "connecting" ? "Connecting" : "Reconnecting"}
          </p>
        </header>

        <div className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="min-h-0 border-b p-5 sm:p-7 lg:border-r lg:border-b-0" aria-labelledby="customer-order-title">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">
                  {isComplete ? "Payment complete" : state.status === "payment" ? "Payment in progress" : "Your order"}
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-[-0.035em]" id="customer-order-title">
                  {isComplete ? "Thank you for your purchase" : hasItems ? "Order summary" : "Ready when you are"}
                </h1>
              </div>
              {state.customer ? (
                <div className="rounded-lg bg-secondary px-3 py-2 text-right">
                  <p className="text-sm font-medium">{state.customer.name}</p>
                  <p className="text-xs text-secondary-foreground/75">{state.customer.loyaltyPoints.toLocaleString()} loyalty points</p>
                </div>
              ) : null}
            </div>

            {hasItems ? (
              <ul className="mt-7 divide-y rounded-xl border bg-card" aria-label="Current order items">
                {state.items.map((item, index) => (
                  <li className="flex items-start justify-between gap-4 px-4 py-4 sm:px-5" key={`${item.name}-${item.variantName ?? ""}-${index}`}>
                    <div className="min-w-0">
                      <p className="font-medium">{item.quantity} × {item.name}</p>
                      {item.variantName ? <p className="mt-1 text-sm text-muted-foreground">{item.variantName}</p> : null}
                      {item.modifiers.length > 0 ? <p className="mt-1 text-xs text-muted-foreground">{item.modifiers.join(", ")}</p> : null}
                    </div>
                    <p className="shrink-0 font-semibold">{formatMinorMoney(item.lineTotalMinor, currencyCode)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-7 grid min-h-72 place-items-center rounded-xl border border-dashed bg-muted/30 p-7 text-center">
                <div>
                  <ShoppingBag aria-hidden="true" className="mx-auto size-10 text-muted-foreground" />
                  <p className="mt-4 font-medium">Your items will appear here</p>
                  <p className="mt-1 text-sm text-muted-foreground">The cashier’s current order updates automatically.</p>
                </div>
              </div>
            )}
          </section>

          <aside className="flex flex-col bg-card p-5 sm:p-7">
            <p className="text-sm font-medium text-muted-foreground">Total due</p>
            <p className="mt-2 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
              {formatMinorMoney(state.totalMinor, currencyCode)}
            </p>
            <dl className="mt-7 space-y-3 border-y py-5 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Subtotal</dt><dd>{formatMinorMoney(state.subtotalMinor, currencyCode)}</dd></div>
              {state.discountMinor > 0 ? <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Discount</dt><dd>−{formatMinorMoney(state.discountMinor, currencyCode)}</dd></div> : null}
              {state.taxMinor > 0 ? <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Tax</dt><dd>{formatMinorMoney(state.taxMinor, currencyCode)}</dd></div> : null}
            </dl>
            {state.payments.length > 0 ? (
              <section className="mt-5" aria-labelledby="customer-display-payment-title">
                <p className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase" id="customer-display-payment-title">Payment</p>
                <ul className="mt-2 space-y-2">
                  {state.payments.map((payment, index) => (
                    <li className="flex items-start justify-between gap-3 text-sm" key={`${payment.name}-${index}`}>
                      <div>
                        <p className="font-medium">{payment.name}</p>
                        {payment.tenderedMinor !== null ? <p className="text-xs text-muted-foreground">Tendered {formatMinorMoney(payment.tenderedMinor, currencyCode)}</p> : null}
                      </div>
                      <p className="font-semibold">{formatMinorMoney(payment.amountMinor, currencyCode)}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {isComplete ? (
              <div className="mt-6 rounded-xl bg-primary p-4 text-primary-foreground">
                <div className="flex items-center gap-2 font-semibold"><CheckCircle2 aria-hidden="true" className="size-5" />Payment complete</div>
                {state.changeMinor > 0 ? <p className="mt-3 text-sm text-primary-foreground/85">Change due: {formatMinorMoney(state.changeMinor, currencyCode)}</p> : null}
                {state.receiptNumber ? <p className="mt-1 text-sm text-primary-foreground/85">Receipt #{state.receiptNumber}</p> : null}
                {digitalReceiptUrl ? (
                  <a className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary-foreground px-3 py-2 text-sm font-semibold text-primary" href={digitalReceiptUrl} target="_blank" rel="noreferrer">
                    <ReceiptText aria-hidden="true" className="size-4" />
                    View digital receipt
                  </a>
                ) : null}
              </div>
            ) : (
              <p className="mt-auto pt-7 text-sm leading-6 text-muted-foreground">Please review your order before payment.</p>
            )}
          </aside>
        </div>

        <footer className="border-t bg-card px-5 py-3 text-center text-xs text-muted-foreground sm:px-7">
          Updated {formatDisplayTime(state.updatedAt)}
        </footer>
      </section>
    </main>
  );
}
