import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { formatMinorMoney } from "@/features/catalog/catalog-money";
import { hashCustomerDisplayToken } from "@/features/customer-display/customer-display-token";
import { createClient } from "@/lib/supabase/server";

const displayTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const saleIdSchema = z.uuid();
const digitalReceiptSchema = z.object({
  business_name: z.string().min(1).max(160),
  store_name: z.string().min(1).max(160),
  register_name: z.string().min(1).max(160),
  currency_code: z.string().regex(/^[A-Z]{3}$/),
  receipt_number: z.number().int().positive(),
  issued_at: z.string().datetime(),
  subtotal_minor: z.number().int().nonnegative(),
  discount_minor: z.number().int().nonnegative(),
  tax_minor: z.number().int().nonnegative(),
  total_minor: z.number().int().nonnegative(),
  items: z.array(z.object({
    name: z.string().min(1).max(160),
    variant_name: z.string().max(160).nullable(),
    modifiers: z.array(z.object({ name: z.string().min(1).max(100) }).passthrough()),
    quantity: z.number().int().positive(),
    line_total_minor: z.number().int().nonnegative(),
  })),
  payments: z.array(z.object({
    name: z.string().min(1).max(100),
    amount_minor: z.number().int().nonnegative(),
    tendered_minor: z.number().int().nonnegative().nullable(),
    change_minor: z.number().int().nonnegative().nullable(),
  })),
});

export const metadata = { title: "Digital receipt" };

function formatIssuedAt(value: string) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default async function CustomerDisplayReceiptPage({
  params,
}: {
  params: Promise<{ token: string; saleId: string }>;
}) {
  await connection();
  const { token, saleId } = await params;
  if (!displayTokenSchema.safeParse(token).success || !saleIdSchema.safeParse(saleId).success) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_customer_display_receipt", {
    target_access_token_hash: hashCustomerDisplayToken(token),
    target_sale_id: saleId,
  });
  const receipt = digitalReceiptSchema.safeParse(data);
  if (error || !receipt.success) notFound();

  const value = receipt.data;
  return (
    <main className="min-h-svh bg-muted/35 p-4 sm:p-7">
      <article className="mx-auto w-full max-w-xl rounded-2xl border bg-card p-5 shadow-sm sm:p-8">
        <header className="border-b border-dashed pb-5 text-center">
          <p className="text-lg font-semibold">{value.business_name}</p>
          <p className="mt-1 text-sm text-muted-foreground">{value.store_name} · {value.register_name}</p>
          <p className="mt-4 text-xs font-semibold tracking-[0.16em] text-primary uppercase">Digital receipt #{value.receipt_number}</p>
          <p className="mt-1 text-xs text-muted-foreground">{formatIssuedAt(value.issued_at)}</p>
        </header>

        <section className="border-b border-dashed py-5" aria-label="Purchased items">
          <ul className="space-y-4">
            {value.items.map((item, index) => (
              <li className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm" key={`${item.name}-${item.variant_name ?? ""}-${index}`}>
                <div>
                  <p className="font-medium">{item.quantity} × {item.name}</p>
                  {item.variant_name ? <p className="mt-0.5 text-xs text-muted-foreground">{item.variant_name}</p> : null}
                  {item.modifiers.length > 0 ? <p className="mt-1 text-xs text-muted-foreground">{item.modifiers.map((modifier) => modifier.name).join(", ")}</p> : null}
                </div>
                <p className="font-medium">{formatMinorMoney(item.line_total_minor, value.currency_code)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="border-b border-dashed py-5 text-sm">
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Subtotal</span><span>{formatMinorMoney(value.subtotal_minor, value.currency_code)}</span></div>
          {value.discount_minor > 0 ? <div className="mt-2 flex justify-between gap-4"><span className="text-muted-foreground">Discount</span><span>-{formatMinorMoney(value.discount_minor, value.currency_code)}</span></div> : null}
          {value.tax_minor > 0 ? <div className="mt-2 flex justify-between gap-4"><span className="text-muted-foreground">Tax</span><span>{formatMinorMoney(value.tax_minor, value.currency_code)}</span></div> : null}
          <div className="mt-4 flex justify-between gap-4 text-base font-bold"><span>Total</span><span>{formatMinorMoney(value.total_minor, value.currency_code)}</span></div>
        </section>

        <section className="py-5 text-sm" aria-labelledby="digital-receipt-payment-title">
          <p className="font-semibold" id="digital-receipt-payment-title">Payment</p>
          <ul className="mt-3 space-y-3">
            {value.payments.map((payment, index) => (
              <li className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1" key={`${payment.name}-${index}`}>
                <span>{payment.name}</span>
                <span className="font-medium">{formatMinorMoney(payment.amount_minor, value.currency_code)}</span>
                {payment.tendered_minor !== null ? <span className="col-span-2 text-xs text-muted-foreground">Tendered {formatMinorMoney(payment.tendered_minor, value.currency_code)}{payment.change_minor ? ` · Change ${formatMinorMoney(payment.change_minor, value.currency_code)}` : ""}</span> : null}
              </li>
            ))}
          </ul>
        </section>

        <p className="border-t pt-5 text-center text-xs leading-5 text-muted-foreground">Thank you for choosing {value.business_name}.</p>
      </article>
    </main>
  );
}
