"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

export function printReceiptDocument() {
  document.body.dataset.printMode = "receipt";
  const cleanup = () => { delete document.body.dataset.printMode; };
  window.addEventListener("afterprint", cleanup, { once: true });
  window.print();
  window.setTimeout(cleanup, 1000);
}

export function ReceiptPrintButton({ printMode }: { printMode?: "receipt" }) {
  const printReceipt = () => {
    if (printMode === "receipt") printReceiptDocument();
    else window.print();
  };

  return (
    <Button onClick={printReceipt} type="button" variant="outline">
      <Printer aria-hidden="true" />
      Print receipt
    </Button>
  );
}
