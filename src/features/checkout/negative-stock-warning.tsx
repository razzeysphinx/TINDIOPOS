"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { NegativeStockItem, NegativeStockPolicy } from "@/features/checkout/checkout-types";

function formatQuantity(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
}

export function NegativeStockWarning({
  items,
  onOpenChange,
  onProceed,
  onReview,
  open,
  policy,
}: {
  items: NegativeStockItem[];
  onOpenChange: (open: boolean) => void;
  onProceed: () => void;
  onReview: () => void;
  open: boolean;
  policy: Exclude<NegativeStockPolicy, "allow">;
}) {
  const isBlocked = policy === "block";
  const count = items.length;

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <DialogContent closeLabel="Close stock check" showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-amber-500/12 text-amber-700 dark:text-amber-400">
              <AlertTriangle aria-hidden="true" className="size-5" />
            </span>
            <div>
              <DialogTitle>{isBlocked ? "Stock check" : "Stock warning"}</DialogTitle>
              <DialogDescription>
                {isBlocked
                  ? `This sale cannot continue because ${count} ${count === 1 ? "item has" : "items have"} insufficient recorded stock.`
                  : `${count} ${count === 1 ? "item has" : "items have"} insufficient recorded stock. Check the items before continuing.`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <ul className="divide-y rounded-xl border" aria-label="Items with insufficient recorded stock">
            {items.map((item) => (
              <li className="p-4" key={`${item.productId}:${item.variantId ?? "simple"}`}>
                <p className="font-medium">
                  {item.productName}{item.variantName ? ` / ${item.variantName}` : ""}
                </p>
                <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Available</dt>
                    <dd className="mt-1 font-semibold tabular-nums">{formatQuantity(item.availableQuantity)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">In cart</dt>
                    <dd className="mt-1 font-semibold tabular-nums">{formatQuantity(item.cartQuantity)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">After sale</dt>
                    <dd className="mt-1 font-semibold tabular-nums text-destructive">{formatQuantity(item.projectedQuantity)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          {!isBlocked ? (
            <p className="text-sm leading-6 text-muted-foreground">
              The physical quantity may differ from what is currently recorded in TINDIO. Proceeding records the normal sale and does not change inventory by any extra amount.
            </p>
          ) : null}
          <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-end">
            <Button className="h-11 w-full sm:w-auto" onClick={onReview} type="button" variant="outline">
              Review cart
            </Button>
            {!isBlocked ? (
              <Button className="h-11 w-full sm:w-auto" onClick={onProceed} type="button">
                Proceed anyway
              </Button>
            ) : null}
          </DialogFooter>
        </DialogBody>
      </DialogContent>
    </Dialog.Root>
  );
}
