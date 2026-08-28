"use client";

import {
  PackageSearch,
  ReceiptText,
  Settings2,
  ShoppingCart,
  WalletCards,
  LogOut,
  Menu,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

export type PosOperationalNavigationProps = {
  /** @deprecated Navigation is now always the shared five-area POS workspace. */
  canSelectCustomer?: boolean;
  /** @deprecated Shift remains a visible POS destination; server/RPC authorization decides actions. */
  canUseShiftControls?: boolean;
  canUseTimeClock: boolean;
  employeeName: string;
  organizationName: string;
  stores: PosStore[];
  timeClockEntry: TimeClockEntry | null;
  timezone: string;
};

const navigationItems = [
  { href: "/pos", icon: ShoppingCart, label: "Sales", matches: (pathname: string) => pathname === "/pos" },
  { href: "/pos/receipts", icon: ReceiptText, label: "Receipts", matches: (pathname: string) => pathname.startsWith("/pos/receipts") },
  { href: "/pos/shifts", icon: WalletCards, label: "Shift", matches: (pathname: string) => pathname.startsWith("/pos/shifts") },
  { href: "/pos/items", icon: PackageSearch, label: "Items", matches: (pathname: string) => pathname.startsWith("/pos/items") },
  { href: "/pos/settings", icon: Settings2, label: "Settings", matches: (pathname: string) => pathname.startsWith("/pos/settings") },
] as const;

function PosOperationalNavigationContent({
  canUseTimeClock,
  onNavigate,
  stores,
  timeClockEntry,
  timezone,
}: Pick<PosOperationalNavigationProps, "canUseTimeClock" | "stores" | "timeClockEntry" | "timezone"> & {
  onNavigate: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-7">
      <nav aria-label="POS workspace" className="space-y-2">
        <h2 className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">Available features</h2>
        <div className="grid gap-1.5">
          {navigationItems.map((item) => {
            const active = item.matches(pathname);
            const Icon = item.icon;

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  buttonVariants({ variant: active ? "secondary" : "ghost" }),
                  "h-10 justify-start",
                )}
                href={item.href}
                key={item.href}
                onClick={onNavigate}
              >
                <Icon aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

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
