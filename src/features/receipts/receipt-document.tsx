import { formatMinorMoney } from "@/features/catalog/catalog-money";

export type ReceiptSaleLine = {
  id: string;
  name: string;
  sku: string | null;
  quantity: number;
  unit: string;
  unitPriceMinor: number;
  lineTotalMinor: number;
};

export type ReceiptPayment = {
  id: string;
  name: string;
  type: string;
  amountMinor: number;
  tenderedMinor: number | null;
  changeMinor: number | null;
  referenceNumber: string | null;
};

export type ReceiptRefund = {
  id: string;
  refundNumber: number;
  totalMinor: number;
  completedAt: string;
  reason: string;
  paymentName: string | null;
  paymentReference: string | null;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unit: string;
    lineTotalMinor: number;
  }>;
};

export type ReceiptLayout = {
  businessName: string;
  businessAddress: string | null;
  businessPhone: string | null;
  businessEmail: string | null;
  businessTaxId: string | null;
  businessWebsite: string | null;
  headerMessage: string | null;
  footerMessage: string;
  paperWidthMm: 58 | 80;
  showStoreAddress: boolean;
  showStorePhone: boolean;
  showCashier: boolean;
  showRegister: boolean;
  showPaymentDetails: boolean;
  storeName: string;
  storeAddress: string | null;
  storePhone: string | null;
};

function snapshotString(
  snapshot: Record<string, unknown>,
  key: string,
  fallback: string | null = null,
) {
  const value = snapshot[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function snapshotBoolean(snapshot: Record<string, unknown>, key: string, fallback: boolean) {
  return typeof snapshot[key] === "boolean" ? snapshot[key] : fallback;
}

export function receiptLayoutFromSnapshot(
  value: unknown,
  fallback: { organizationName: string; storeName: string },
): ReceiptLayout {
  const snapshot = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const paperWidth = snapshot.paper_width_mm;
  const fallbackFooter = `Thank you for choosing ${fallback.organizationName}.`;

  return {
    businessName:
      snapshotString(snapshot, "business_name", fallback.organizationName) ?? fallback.organizationName,
    businessAddress: snapshotString(snapshot, "business_address"),
    businessPhone: snapshotString(snapshot, "business_phone"),
    businessEmail: snapshotString(snapshot, "business_email"),
    businessTaxId: snapshotString(snapshot, "business_tax_id"),
    businessWebsite: snapshotString(snapshot, "business_website"),
    headerMessage: snapshotString(snapshot, "header_message"),
    footerMessage: snapshotString(snapshot, "footer_message", fallbackFooter) ?? fallbackFooter,
    paperWidthMm: paperWidth === 58 ? 58 : 80,
    showStoreAddress: snapshotBoolean(snapshot, "show_store_address", true),
    showStorePhone: snapshotBoolean(snapshot, "show_store_phone", true),
    showCashier: snapshotBoolean(snapshot, "show_cashier", true),
    showRegister: snapshotBoolean(snapshot, "show_register", true),
    showPaymentDetails: snapshotBoolean(snapshot, "show_payment_details", true),
    storeName: snapshotString(snapshot, "store_name", fallback.storeName) ?? fallback.storeName,
    storeAddress: snapshotString(snapshot, "store_address"),
    storePhone: snapshotString(snapshot, "store_phone"),
  };
}

function formatReceiptDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export function ReceiptDocument({
  layout,
  timezone,
  receiptNumber,
  issuedAt,
  currencyCode,
  registerName,
  cashierName,
  subtotalMinor,
  discountMinor,
  taxMinor,
  totalMinor,
  lines,
  payments,
  refunds,
}: {
  layout: ReceiptLayout;
  timezone: string;
  receiptNumber: number;
  issuedAt: string;
  currencyCode: string;
  registerName: string;
  cashierName: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  lines: ReceiptSaleLine[];
  payments: ReceiptPayment[];
  refunds: ReceiptRefund[];
}) {
  const totalRefundedMinor = refunds.reduce((total, refund) => total + refund.totalMinor, 0);
  const businessContact = [
    layout.businessTaxId ? `Tax ID: ${layout.businessTaxId}` : null,
    layout.businessPhone,
    layout.businessEmail,
    layout.businessWebsite,
  ].filter(Boolean).join(" · ");

  return (
    <article
      className={`mx-auto w-full max-w-xl rounded-xl border bg-card p-5 shadow-sm sm:p-7 print:rounded-none print:border-0 print:p-2 print:shadow-none ${layout.paperWidthMm === 58 ? "print:max-w-[58mm]" : "print:max-w-[80mm]"}`}
      data-receipt-document
    >
      <header className="border-b border-dashed pb-4 text-center">
        <p className="text-xl font-bold tracking-[-0.03em]">{layout.businessName}</p>
        {layout.headerMessage ? <p className="mt-1 text-xs text-muted-foreground">{layout.headerMessage}</p> : null}
        {layout.businessAddress ? <p className="mt-2 text-xs text-muted-foreground">{layout.businessAddress}</p> : null}
        {businessContact ? <p className="mt-1 text-xs text-muted-foreground">{businessContact}</p> : null}
        <p className="mt-3 text-sm font-medium">{layout.storeName}</p>
        {layout.showStoreAddress && layout.storeAddress ? (
          <p className="mt-1 text-xs text-muted-foreground">{layout.storeAddress}</p>
        ) : null}
        {layout.showStorePhone && layout.storePhone ? (
          <p className="mt-1 text-xs text-muted-foreground">{layout.storePhone}</p>
        ) : null}
        <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Receipt #{receiptNumber}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{formatReceiptDate(issuedAt, timezone)}</p>
        {layout.showRegister ? <p className="mt-1 text-xs text-muted-foreground">Register: {registerName}</p> : null}
        {layout.showCashier ? <p className="mt-1 text-xs text-muted-foreground">Cashier: {cashierName}</p> : null}
      </header>

      <section className="border-b border-dashed py-4" aria-label="Purchased items">
        <div className="space-y-3">
          {lines.map((line) => (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3" key={line.id}>
              <div className="min-w-0">
                <p className="truncate font-medium">{line.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {line.quantity} {line.unit} × {formatMinorMoney(line.unitPriceMinor, currencyCode)}
                  {line.sku ? ` · ${line.sku}` : ""}
                </p>
              </div>
              <p className="font-medium">{formatMinorMoney(line.lineTotalMinor, currencyCode)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-b border-dashed py-4 text-sm">
        <ReceiptAmount label="Subtotal" value={formatMinorMoney(subtotalMinor, currencyCode)} />
        {discountMinor > 0 ? (
          <ReceiptAmount label="Discount" value={`−${formatMinorMoney(discountMinor, currencyCode)}`} />
        ) : null}
        {taxMinor > 0 ? <ReceiptAmount label="Tax" value={formatMinorMoney(taxMinor, currencyCode)} /> : null}
        <div className="mt-3 flex items-center justify-between gap-3 text-base font-bold">
          <span>Total</span>
          <span>{formatMinorMoney(totalMinor, currencyCode)}</span>
        </div>
      </section>

      {layout.showPaymentDetails ? (
        <section className="border-b border-dashed py-4" aria-label="Payments">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Payment</p>
          <div className="mt-2 space-y-2 text-sm">
            {payments.map((payment) => (
              <div key={payment.id}>
                <div className="flex justify-between gap-3">
                  <span>{payment.name}</span>
                  <span className="font-medium">{formatMinorMoney(payment.amountMinor, currencyCode)}</span>
                </div>
                {payment.tenderedMinor !== null ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Tendered {formatMinorMoney(payment.tenderedMinor, currencyCode)}
                    {payment.changeMinor ? ` · Change ${formatMinorMoney(payment.changeMinor, currencyCode)}` : ""}
                  </p>
                ) : null}
                {payment.referenceNumber ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">Ref. {payment.referenceNumber}</p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {refunds.length > 0 ? (
        <section className="border-b border-dashed py-4" aria-label="Refund history">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Refund history</p>
            <p className="text-sm font-semibold text-destructive">−{formatMinorMoney(totalRefundedMinor, currencyCode)}</p>
          </div>
          <div className="mt-3 space-y-4 text-sm">
            {refunds.map((refund) => (
              <div key={refund.id}>
                <div className="flex justify-between gap-3">
                  <span className="font-medium">Refund #{refund.refundNumber}</span>
                  <span className="font-medium">−{formatMinorMoney(refund.totalMinor, currencyCode)}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatReceiptDate(refund.completedAt, timezone)} · {refund.reason}
                </p>
                {refund.items.map((item) => (
                  <p className="mt-1 text-xs text-muted-foreground" key={item.id}>
                    {item.quantity} {item.unit} × {item.name}
                  </p>
                ))}
                {refund.paymentName ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Returned by {refund.paymentName}
                    {refund.paymentReference ? ` · Ref. ${refund.paymentReference}` : ""}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">Inventory-only return</p>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <footer className="pt-4 text-center text-xs text-muted-foreground">
        <p>{layout.footerMessage}</p>
        <p className="mt-1">TINDIO · Sell simple. Grow smarter.</p>
      </footer>
    </article>
  );
}

function ReceiptAmount({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-1 flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
