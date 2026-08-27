"use client";

import { useMemo, useState } from "react";
import { Printer } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { code39SvgMarkup, createCode39Barcode } from "@/features/catalog/code39";

type ProductLabelPrintButtonProps = {
  barcode: string | null;
  price: string;
  productName: string;
  sku: string | null;
};

export function ProductLabelPrintButton({
  barcode,
  price,
  productName,
  sku,
}: ProductLabelPrintButtonProps) {
  const [open, setOpen] = useState(false);
  const barcodeModel = useMemo(() => (barcode ? createCode39Barcode(barcode) : null), [barcode]);
  const unavailableReason = !barcode
    ? "Generate or enter a barcode before printing a label."
    : "This barcode contains characters that cannot be printed as a Code 39 label.";

  if (!barcodeModel) {
    return (
      <Button disabled size="sm" title={unavailableReason} type="button" variant="outline">
        <Printer aria-hidden="true" />
        Print label
      </Button>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonVariants({ size: "sm", variant: "outline" })}>
        <Printer aria-hidden="true" />
        Print label
      </DialogTrigger>
      <DialogContent>
          <DialogHeader>
            <DialogTitle>Print product label</DialogTitle>
            <DialogDescription>
              One 50 × 30 mm TINDIO label. Generated TINDIO codes are compatible with Code 39 scanners.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <ProductLabelPreview barcode={barcodeModel} price={price} productName={productName} sku={sku} />
            {barcodeModel.value.length > 24 ? (
              <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
                This barcode is long for a 50 mm label. Use a larger label if your scanner cannot read it reliably.
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter className="border-t px-6 py-4">
            <Button
              onClick={() => printProductLabel({ barcode: barcodeModel, price, productName, sku })}
              type="button"
            >
              <Printer aria-hidden="true" />
              Print label
            </Button>
          </DialogFooter>
      </DialogContent>
    </Dialog.Root>
  );
}

function ProductLabelPreview({
  barcode,
  price,
  productName,
  sku,
}: {
  barcode: NonNullable<ReturnType<typeof createCode39Barcode>>;
  price: string;
  productName: string;
  sku: string | null;
}) {
  return (
    <section className="mx-auto grid w-full max-w-80 gap-2 border bg-white p-4 text-black shadow-sm" aria-label="Product label preview">
      <p className="truncate text-sm font-bold leading-tight">{productName}</p>
      <p className="text-base font-semibold">{price}</p>
      <svg
        aria-label={`Barcode ${barcode.value}`}
        className="h-14 w-full"
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${barcode.width} 100`}
      >
        {barcode.bars.map(({ x, width }) => <rect height="100" key={`${x}-${width}`} width={width} x={x} y="0" />)}
      </svg>
      <p className="text-center font-mono text-[10px] tracking-[0.14em]">{barcode.value}</p>
      <p className="truncate text-[10px] text-neutral-700">SKU: {sku || "Not set"}</p>
    </section>
  );
}

function printProductLabel({
  barcode,
  price,
  productName,
  sku,
}: {
  barcode: NonNullable<ReturnType<typeof createCode39Barcode>>;
  price: string;
  productName: string;
  sku: string | null;
}) {
  const printWindow = window.open("", "tindio-product-label", "width=500,height=360");
  if (!printWindow) return;

  const escapeHtml = (value: string) => value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html><head><title>TINDIO product label</title><style>
  @page { size: 50mm 30mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { width: 50mm; height: 30mm; margin: 0; background: white; color: black; font-family: Arial, sans-serif; }
  main { display: grid; gap: 1.2mm; height: 30mm; padding: 2.2mm; }
  .name { overflow: hidden; font-size: 10pt; font-weight: 700; line-height: 1.05; text-overflow: ellipsis; white-space: nowrap; }
  .price { font-size: 11pt; font-weight: 700; }
  svg { display: block; height: 10mm; width: 100%; }
  .barcode { font-family: monospace; font-size: 7pt; letter-spacing: .55pt; text-align: center; }
  .sku { overflow: hidden; color: #333; font-size: 6.5pt; text-overflow: ellipsis; white-space: nowrap; }
</style></head><body><main>
  <div class="name">${escapeHtml(productName)}</div>
  <div class="price">${escapeHtml(price)}</div>
  ${code39SvgMarkup(barcode)}
  <div class="barcode">${escapeHtml(barcode.value)}</div>
  <div class="sku">SKU: ${escapeHtml(sku || "Not set")}</div>
</main></body></html>`);
  printWindow.document.close();
  printWindow.setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 50);
}
