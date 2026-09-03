"use client";

import { ShoppingCart, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { OfflineQueueStatus } from "@/features/offline/offline-queue-status";
import { PosOperationalDrawer, type PosOperationalNavigationProps } from "@/features/pos/pos-operational-drawer";

type PosWorkspaceHeaderProps = PosOperationalNavigationProps & {
  canAccessBackOffice: boolean;
  itemCount?: number;
  onCreateCustomer?: () => void;
  onViewCart?: () => void;
  scope: string;
  title: string;
};

export function PosWorkspaceHeader({
  canAccessBackOffice,
  employeeName,
  itemCount,
  onCreateCustomer,
  onViewCart,
  organizationName,
  scope,
  title,
  ...navigationProps
}: PosWorkspaceHeaderProps) {
  const ticketLabel = typeof itemCount === "number"
    ? `${title} · ${itemCount} ${itemCount === 1 ? "item" : "items"}`
    : title;

  return (
    <header className="sticky top-0 z-40 flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-card px-3 py-2.5 shadow-[0_1px_2px_rgb(0_0_0_/_0.04)] sm:gap-3 sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <PosOperationalDrawer
          canAccessBackOffice={canAccessBackOffice}
          employeeName={employeeName}
          organizationName={organizationName}
          {...navigationProps}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{ticketLabel}</p>
          <p className="truncate text-xs text-muted-foreground">{organizationName} · {employeeName}</p>
        </div>
      </div>

      <div className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
        {onViewCart ? (
          <Button
            aria-label={"View cart" + (itemCount ? ", " + itemCount + " " + (itemCount === 1 ? "item" : "items") : "")}
            className="relative lg:hidden"
            onClick={onViewCart}
            size="icon"
            type="button"
            variant="outline"
          >
            <ShoppingCart aria-hidden="true" />
            {itemCount ? (
              <span
                aria-hidden="true"
                className="absolute -top-1.5 -right-1.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground"
              >
                {itemCount > 99 ? "99+" : itemCount}
              </span>
            ) : null}
          </Button>
        ) : null}
        {onCreateCustomer ? (
          <Button onClick={onCreateCustomer} size="sm" type="button" variant="outline">
            <UserPlus aria-hidden="true" />
            <span className="hidden sm:inline">New customer</span>
            <span className="sm:hidden">Customer</span>
          </Button>
        ) : null}
        <OfflineQueueStatus scope={scope} />
      </div>
    </header>
  );
}
