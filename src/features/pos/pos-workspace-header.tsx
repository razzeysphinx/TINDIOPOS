"use client";

import { Ellipsis, ExternalLink, LockKeyhole, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { signOutAction } from "@/features/auth/actions";
import { OfflineQueueStatus } from "@/features/offline/offline-queue-status";
import { PosOperationalDrawer, type PosOperationalNavigationProps } from "@/features/pos/pos-operational-drawer";
import { cn } from "@/lib/utils";

type PosWorkspaceHeaderProps = PosOperationalNavigationProps & {
  canAccessBackOffice: boolean;
  canCloseShift?: boolean;
  closeShiftDisabled?: boolean;
  itemCount?: number;
  onCloseShift?: () => void;
  onSelectCustomer?: () => void;
  scope: string;
  title: string;
};

export function PosWorkspaceHeader({
  canAccessBackOffice,
  canCloseShift = false,
  closeShiftDisabled = false,
  employeeName,
  itemCount,
  onCloseShift,
  onSelectCustomer,
  organizationName,
  scope,
  title,
  ...navigationProps
}: PosWorkspaceHeaderProps) {
  const [isUtilitiesOpen, setIsUtilitiesOpen] = useState(false);
  const ticketLabel = typeof itemCount === "number"
    ? `${title} · ${itemCount} ${itemCount === 1 ? "item" : "items"}`
    : title;

  return (
    <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2.5 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <PosOperationalDrawer
          employeeName={employeeName}
          organizationName={organizationName}
          {...navigationProps}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{ticketLabel}</p>
          <p className="truncate text-xs text-muted-foreground">{organizationName} · {employeeName}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {onSelectCustomer ? (
          <Button className="hidden sm:inline-flex" onClick={onSelectCustomer} size="sm" type="button" variant="outline">
            <UserRound aria-hidden="true" />
            Customer
          </Button>
        ) : null}
        <OfflineQueueStatus scope={scope} />
        <Dialog.Root onOpenChange={setIsUtilitiesOpen} open={isUtilitiesOpen}>
          <DialogTrigger
            aria-label="Open POS utilities"
            className={cn(buttonVariants({ size: "icon", variant: "outline" }), "shrink-0")}
            title="POS utilities"
          >
            <Ellipsis aria-hidden="true" />
          </DialogTrigger>
          <DialogContent className="w-full max-w-sm" side="right">
            <DialogHeader>
              <DialogTitle>POS utilities</DialogTitle>
            </DialogHeader>
            <DialogBody className="grid gap-2 p-5">
              {onSelectCustomer ? (
                <Button
                  className="justify-start sm:hidden"
                  onClick={() => {
                    setIsUtilitiesOpen(false);
                    onSelectCustomer();
                  }}
                  type="button"
                  variant="outline"
                >
                  <UserRound aria-hidden="true" />
                  Customer / loyalty
                </Button>
              ) : null}
              {canCloseShift && onCloseShift ? (
                <Button
                  className="justify-start"
                  disabled={closeShiftDisabled}
                  onClick={() => {
                    setIsUtilitiesOpen(false);
                    onCloseShift();
                  }}
                  type="button"
                  variant="outline"
                >
                  <LockKeyhole aria-hidden="true" />
                  Close shift
                </Button>
              ) : null}
              {canAccessBackOffice ? (
                <Link
                  className={cn(buttonVariants({ variant: "outline" }), "justify-start")}
                  href="/back-office"
                  onClick={() => setIsUtilitiesOpen(false)}
                >
                  <ExternalLink aria-hidden="true" />
                  Back Office
                </Link>
              ) : null}
              <form action={signOutAction} onSubmit={() => setIsUtilitiesOpen(false)}>
                <Button className="w-full justify-start" type="submit" variant="outline">
                  <LogOut aria-hidden="true" />
                  Sign out
                </Button>
              </form>
            </DialogBody>
          </DialogContent>
        </Dialog.Root>
      </div>
    </header>
  );
}
