"use client";

import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { CircleUserRound, Menu } from "lucide-react";
import { usePathname } from "next/navigation";

import {
  BackOfficeNavigation,
  type BackOfficeNavigationAccess,
  getBackOfficePageTitle,
} from "@/components/back-office/back-office-navigation";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type SidebarContextValue = {
  isCollapsed: boolean;
  setIsCollapsed: Dispatch<SetStateAction<boolean>>;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

function useBackOfficeSidebar() {
  const context = useContext(SidebarContext);

  if (!context) {
    throw new Error("Back Office sidebar controls must be used inside BackOfficeWorkspaceShell.");
  }

  return context;
}

export function BackOfficeHeaderControls() {
  const { isCollapsed, setIsCollapsed } = useBackOfficeSidebar();
  const pathname = usePathname();
  const toggleLabel = isCollapsed ? "Expand Back Office sidebar" : "Collapse Back Office sidebar";

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Button
        aria-expanded={!isCollapsed}
        aria-label={toggleLabel}
        onClick={() => setIsCollapsed((current) => !current)}
        size="icon-sm"
        title={toggleLabel}
        type="button"
        variant="ghost"
      >
        <Menu aria-hidden="true" />
      </Button>
      <p className="truncate text-base font-semibold tracking-[-0.02em]">
        {getBackOfficePageTitle(pathname)}
      </p>
    </div>
  );
}

export function BackOfficeMobileNavigation({
  navigationAccess,
}: {
  navigationAccess: BackOfficeNavigationAccess;
}) {
  const { isCollapsed, setIsCollapsed } = useBackOfficeSidebar();

  if (isCollapsed) {
    return null;
  }

  return (
    <BackOfficeNavigation
      {...navigationAccess}
      mobile
      onNavigate={() => setIsCollapsed(true)}
    />
  );
}

export function BackOfficeWorkspaceShell({
  children,
  displayName,
  employeeNumber,
  header,
  navigationAccess,
}: {
  children: ReactNode;
  displayName: string;
  employeeNumber: string;
  header: ReactNode;
  navigationAccess: BackOfficeNavigationAccess;
}) {
  const [isCollapsed, setIsCollapsed] = useState(true);

  return (
    <SidebarContext.Provider value={{ isCollapsed, setIsCollapsed }}>
      <div className="min-h-svh bg-muted/35 pt-14">
        {header}
        <div
          className={cn(
            "min-h-[calc(100svh-3.5rem)] lg:grid lg:transition-[grid-template-columns] lg:duration-200",
            isCollapsed ? "lg:grid-cols-[5rem_minmax(0,1fr)]" : "lg:grid-cols-[16rem_minmax(0,1fr)]",
          )}
        >
          <aside
            aria-label="Back Office sidebar"
            className="hidden min-w-0 overflow-hidden border-r border-border bg-card print:hidden lg:sticky lg:top-14 lg:flex lg:h-[calc(100svh-3.5rem)] lg:self-start lg:flex-col"
          >
            <div className={cn("border-b border-border", isCollapsed ? "grid place-items-center p-3" : "p-4")}>
              {isCollapsed ? (
                <Tooltip content={`${displayName} (${employeeNumber})`} side="right">
                  <span className="grid size-8 place-items-center rounded-full bg-secondary text-secondary-foreground">
                    <CircleUserRound aria-hidden="true" className="size-4" />
                  </span>
                </Tooltip>
              ) : (
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground">
                    <CircleUserRound aria-hidden="true" className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{displayName}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{employeeNumber}</p>
                  </div>
                </div>
              )}
            </div>
            <BackOfficeNavigation {...navigationAccess} collapsed={isCollapsed} />
          </aside>

          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}
