"use client";

import { Clock3, LogOut, Menu, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

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
import { Button, buttonVariants } from "@/components/ui/button";
import { signOutAction } from "@/features/auth/actions";
import type { PosStore } from "@/features/pos/pos-types";
import { TimeClockControl } from "@/features/time-clock/time-clock-control";
import type { TimeClockEntry } from "@/features/time-clock/time-clock-types";
import { cn } from "@/lib/utils";

export function focusCustomerPicker() {
  document.getElementById("pos-customer-picker")?.scrollIntoView({ behavior: "smooth", block: "center" });
  const trigger = document.getElementById("pos-customer-picker-trigger");

  if (trigger instanceof HTMLButtonElement) {
    trigger.click();
  }

  window.setTimeout(() => document.getElementById("pos-customer-search")?.focus(), 100);
}

type PosOperationalNavigationProps = {
  canSelectCustomer?: boolean;
  canUseShiftControls: boolean;
  canUseTimeClock: boolean;
  employeeName: string;
  organizationName: string;
  stores: PosStore[];
  timeClockEntry: TimeClockEntry | null;
  timezone: string;
};

function PosOperationalNavigationContent({
  canSelectCustomer = false,
  canUseShiftControls,
  canUseTimeClock,
  onNavigate,
  stores,
  timeClockEntry,
  timezone,
}: Pick<PosOperationalNavigationProps, "canSelectCustomer" | "canUseShiftControls" | "canUseTimeClock" | "stores" | "timeClockEntry" | "timezone"> & {
  onNavigate: () => void;
}) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="pos-tools-workspace">
        <h2 className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase" id="pos-tools-workspace">
          Available features
        </h2>
        <div className="mt-3 grid gap-2">
          {canSelectCustomer ? (
            <Button
              className="justify-start"
              onClick={() => {
                onNavigate();
                window.setTimeout(focusCustomerPicker, 0);
              }}
              type="button"
              variant="outline"
            >
              <UserRound aria-hidden="true" />
              Customer lookup
            </Button>
          ) : null}
          {canUseShiftControls ? (
            <Link
              className={cn(buttonVariants({ variant: "outline" }), "justify-start")}
              href="/pos/shifts"
              onClick={onNavigate}
            >
              <Clock3 aria-hidden="true" />
              Shift controls
            </Link>
          ) : null}
        </div>
      </section>

      {canUseTimeClock ? (
        <section aria-labelledby="pos-tools-time-clock">
          <h2 className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase" id="pos-tools-time-clock">
            Attendance
          </h2>
          <div className="mt-3">
            <TimeClockControl initialEntry={timeClockEntry} stores={stores} timezone={timezone} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function PosOperationalDrawer({
  employeeName,
  organizationName,
  ...navigationProps
}: PosOperationalNavigationProps) {
  const [open, setOpen] = useState(false);
  const closeNavigation = () => setOpen(false);

  return (
    <Dialog.Root onOpenChange={setOpen} open={open}>
      <DialogTrigger
        aria-label="Open POS navigation"
        className={buttonVariants({ size: "icon", variant: "outline" })}
        title="Open POS navigation"
      >
        <Menu aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="flex flex-col" showCloseButton={false} side="left">
        <DialogHeader className="flex items-start justify-between gap-3 pr-5">
          <div>
            <DialogTitle>POS navigation</DialogTitle>
            <DialogDescription>
              {organizationName} / {employeeName}
            </DialogDescription>
          </div>
          <Button
            aria-label="Close POS navigation"
            onClick={closeNavigation}
            size="icon"
            title="Close POS navigation"
            type="button"
            variant="ghost"
          >
            <Menu aria-hidden="true" />
          </Button>
        </DialogHeader>
        <DialogBody className="max-h-none flex-1 overflow-y-auto p-5">
          <PosOperationalNavigationContent {...navigationProps} onNavigate={closeNavigation} />
        </DialogBody>
        <DialogFooter className="border-t p-5">
          <form action={signOutAction} className="w-full" onSubmit={closeNavigation}>
            <Button className="w-full" type="submit" variant="outline">
              <LogOut aria-hidden="true" />
              Sign out
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog.Root>
  );
}
