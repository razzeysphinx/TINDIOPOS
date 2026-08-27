"use client";

import { ArrowLeft, Clock3, LogOut, Menu, UserRound } from "lucide-react";
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
import { TimeClockControl } from "@/features/time-clock/time-clock-control";
import type { TimeClockEntry } from "@/features/time-clock/time-clock-types";
import type { PosStore } from "@/features/pos/pos-types";
import { cn } from "@/lib/utils";

function focusCustomerPicker() {
  document.getElementById("pos-customer-picker")?.scrollIntoView({ behavior: "smooth", block: "center" });
  const trigger = document.getElementById("pos-customer-picker-trigger");

  if (trigger instanceof HTMLButtonElement) {
    trigger.click();
  }

  window.setTimeout(() => document.getElementById("pos-customer-search")?.focus(), 100);
}

export function PosOperationalDrawer({
  canAccessBackOffice,
  canSelectCustomer = false,
  canUseShiftControls,
  canUseTimeClock,
  employeeName,
  organizationName,
  stores,
  timeClockEntry,
  timezone,
}: {
  canAccessBackOffice: boolean;
  canSelectCustomer?: boolean;
  canUseShiftControls: boolean;
  canUseTimeClock: boolean;
  employeeName: string;
  organizationName: string;
  stores: PosStore[];
  timeClockEntry: TimeClockEntry | null;
  timezone: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root onOpenChange={setOpen} open={open}>
      <DialogTrigger
        aria-label="Open POS tools"
        className={buttonVariants({ size: "sm", variant: "outline" })}
      >
        <Menu aria-hidden="true" />
        POS tools
      </DialogTrigger>
      <DialogContent className="flex flex-col" side="right">
        <DialogHeader>
          <DialogTitle>POS tools</DialogTitle>
          <DialogDescription>
            {organizationName} · {employeeName}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-none flex-1 space-y-6 overflow-y-auto p-5">
          <section aria-labelledby="pos-tools-workspace">
            <h2 className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase" id="pos-tools-workspace">
              Workspace
            </h2>
            <div className="mt-3 grid gap-2">
              {canSelectCustomer ? (
                <Button
                  className="justify-start"
                  onClick={() => {
                    setOpen(false);
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
                  onClick={() => setOpen(false)}
                >
                  <Clock3 aria-hidden="true" />
                  Shift controls
                </Link>
              ) : null}
              {canAccessBackOffice ? (
                <Link
                  className={cn(buttonVariants({ variant: "ghost" }), "justify-start")}
                  href="/back-office"
                  onClick={() => setOpen(false)}
                >
                  <ArrowLeft aria-hidden="true" />
                  Back Office
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
        </DialogBody>
        <DialogFooter className="border-t p-5">
          <form action={signOutAction} className="w-full">
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
