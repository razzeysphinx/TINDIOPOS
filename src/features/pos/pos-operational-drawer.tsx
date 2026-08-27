"use client";

import { Clock3, LogOut, Menu, MonitorSmartphone, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

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

export function focusCustomerPicker() {
  document.getElementById("pos-customer-picker")?.scrollIntoView({ behavior: "smooth", block: "center" });
  const trigger = document.getElementById("pos-customer-picker-trigger");

  if (trigger instanceof HTMLButtonElement) {
    trigger.click();
  }

  window.setTimeout(() => document.getElementById("pos-customer-search")?.focus(), 100);
}

export function PosOperationalDrawer({
  canSelectCustomer = false,
  canUseShiftControls,
  canUseTimeClock,
  employeeName,
  organizationName,
  stores,
  timeClockEntry,
  timezone,
}: {
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenMessage, setFullscreenMessage] = useState<string | null>(null);

  useEffect(() => {
    const updateFullscreenState = () => setIsFullscreen(document.fullscreenElement !== null);

    updateFullscreenState();
    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () => document.removeEventListener("fullscreenchange", updateFullscreenState);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
      setFullscreenMessage(null);
    } catch {
      setFullscreenMessage("This browser does not allow full-screen mode right now.");
    }
  };

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
          <DialogTitle>Cashier navigation</DialogTitle>
          <DialogDescription>
            {organizationName} · {employeeName}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-none flex-1 space-y-6 overflow-y-auto p-5">
          <section aria-labelledby="pos-tools-workspace">
            <h2 className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase" id="pos-tools-workspace">
              Register tools
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
            </div>
          </section>

          <section aria-labelledby="pos-tools-settings">
            <h2 className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase" id="pos-tools-settings">
              POS settings
            </h2>
            <div className="mt-3 grid gap-2">
              <Button className="justify-start" onClick={() => void toggleFullscreen()} type="button" variant="outline">
                <MonitorSmartphone aria-hidden="true" />
                {isFullscreen ? "Exit full-screen mode" : "Enter full-screen mode"}
              </Button>
              {fullscreenMessage ? <p aria-live="polite" className="text-xs text-muted-foreground">{fullscreenMessage}</p> : null}
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
