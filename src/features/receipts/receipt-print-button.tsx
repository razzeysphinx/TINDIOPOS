"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

export function ReceiptPrintButton({ printMode }: { printMode?: "receipt" }) {
  const printReceipt = () => {
    if (printMode === "receipt") document.body.dataset.printMode = "receipt";
    window.print();
    if (printMode === "receipt") window.setTimeout(() => { delete document.body.dataset.printMode; }, 0);
  };

  return (
    <Button onClick={printReceipt} type="button" variant="outline">
      <Printer aria-hidden="true" />
      Print receipt
    </Button>
  );
}
