"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, CircleUserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  BackOfficeNavigation,
  type BackOfficeNavigationAccess,
} from "@/components/back-office/back-office-navigation";
import { TindioMark } from "@/components/brand/tindio-mark";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function BackOfficeWorkspaceShell({
  children,
  displayName,
  employeeNumber,
  navigationAccess,
}: {
  children: ReactNode;
  displayName: string;
  employeeNumber: string;
  navigationAccess: BackOfficeNavigationAccess;
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const toggleLabel = isCollapsed ? "Expand Back Office sidebar" : "Collapse Back Office sidebar";

  return (
    <div
      className={cn(
        "min-h-svh bg-muted/35 lg:grid lg:transition-[grid-template-columns] lg:duration-200",
        isCollapsed ? "lg:grid-cols-[5rem_minmax(0,1fr)]" : "lg:grid-cols-[16rem_minmax(0,1fr)]",
      )}
    >
      <aside
        aria-label="Back Office sidebar"
        className="hidden min-w-0 overflow-hidden border-r border-border bg-card print:hidden lg:sticky lg:top-0 lg:flex lg:h-svh lg:self-start lg:flex-col"
      >
        <div className={cn("border-b border-border", isCollapsed ? "grid place-items-center gap-2 p-3" : "flex min-h-17 items-center gap-2 px-4 py-3")}>
          <Link
            aria-label="TINDIO Back Office"
            className={cn("min-w-0", isCollapsed ? "[&>span:last-child]:hidden" : "flex-1")}
            href="/back-office"
          >
            <TindioMark className={isCollapsed ? "justify-center" : undefined} />
          </Link>
          <Button
            aria-label={toggleLabel}
            onClick={() => setIsCollapsed((current) => !current)}
            size="icon-sm"
            title={toggleLabel}
            type="button"
            variant="ghost"
          >
            {isCollapsed ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
          </Button>
        </div>
        <BackOfficeNavigation {...navigationAccess} collapsed={isCollapsed} />
        {isCollapsed ? (
          <div className="mt-auto border-t border-border p-3">
            <Tooltip content={`${displayName} (${employeeNumber})`} side="right">
              <span className="grid size-8 place-items-center rounded-full bg-secondary text-secondary-foreground">
                <CircleUserRound className="size-4" aria-hidden="true" />
              </span>
            </Tooltip>
          </div>
        ) : (
          <div className="mt-auto border-t border-border p-4">
            <p className="truncate text-sm font-semibold">{displayName}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">{employeeNumber}</p>
          </div>
        )}
      </aside>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
