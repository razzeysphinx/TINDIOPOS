"use client";

import { LoaderCircle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RefundStatus = "available" | "partially-refunded" | "refunded";

export function ReceiptRefundActions({
  canRefund,
  receiptNumber,
  refundHref,
  refundStatus,
  viewHref,
}: {
  canRefund: boolean;
  receiptNumber: number;
  refundHref: string;
  refundStatus: RefundStatus;
  viewHref?: string;
}) {
  const [isOpeningRefund, setIsOpeningRefund] = useState(false);
  const fullyRefunded = refundStatus === "refunded";

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {viewHref ? (
        <Link
          aria-label={`View receipt ${receiptNumber}`}
          className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
          href={viewHref}
        >
          View
        </Link>
      ) : null}
      {canRefund && fullyRefunded ? (
        <button
          aria-describedby={`receipt-${receiptNumber}-refund-help`}
          className={cn(buttonVariants({ size: "sm", variant: "outline" }), "cursor-not-allowed opacity-60")}
          disabled
          type="button"
        >
          Refunded
          <span className="sr-only" id={`receipt-${receiptNumber}-refund-help`}>
            All refundable quantities have already been returned.
          </span>
        </button>
      ) : null}
      {canRefund && !fullyRefunded ? (
        <Link
          aria-busy={isOpeningRefund}
          aria-disabled={isOpeningRefund}
          aria-label={`Refund receipt ${receiptNumber}`}
          className={cn(
            buttonVariants({ size: "sm", variant: "destructive" }),
            isOpeningRefund && "pointer-events-none",
          )}
          href={refundHref}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            if (isOpeningRefund) {
              event.preventDefault();
              return;
            }
            setIsOpeningRefund(true);
          }}
        >
          {isOpeningRefund ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
          {isOpeningRefund ? "Opening refund..." : "Refund"}
        </Link>
      ) : null}
    </div>
  );
}
