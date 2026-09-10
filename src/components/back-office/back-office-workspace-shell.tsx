"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { CircleUserRound, Menu } from "lucide-react";
import { usePathname } from "next/navigation";

import {
  BackOfficeNavigation,
  type BackOfficeNavigationAccess,
  getBackOfficePageTitle,
} from "@/components/back-office/back-office-navigation";
import { BackOfficeNavigationProvider } from "@/components/back-office/back-office-navigation-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type SidebarContextValue = {
  isDesktopSidebarCollapsed: boolean;
  isDesktopViewport: boolean;
  isMobileNavigationOpen: boolean;
  setIsMobileNavigationOpen: (open: boolean) => void;
  toggleNavigation: () => void;
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
  const {
    isDesktopSidebarCollapsed,
    isDesktopViewport,
    isMobileNavigationOpen,
    toggleNavigation,
  } = useBackOfficeSidebar();
  const pathname = usePathname();
  const isNavigationExpanded = isDesktopViewport
    ? !isDesktopSidebarCollapsed
    : isMobileNavigationOpen;
  const toggleLabel = isDesktopViewport
    ? isDesktopSidebarCollapsed
      ? "Expand Back Office sidebar"
      : "Collapse Back Office sidebar"
    : isMobileNavigationOpen
      ? "Close Back Office navigation"
      : "Open Back Office navigation";

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
      <Button
        aria-controls={isDesktopViewport ? "back-office-sidebar" : "back-office-mobile-navigation"}
        aria-expanded={isNavigationExpanded}
        aria-label={toggleLabel}
        onClick={toggleNavigation}
        className="size-11 shrink-0 lg:size-7"
        size="icon-sm"
        title={toggleLabel}
        type="button"
        variant="ghost"
      >
        <Menu aria-hidden="true" />
      </Button>
      <p className="truncate text-sm font-semibold tracking-[-0.02em] sm:text-base">
        {getBackOfficePageTitle(pathname)}
      </p>
    </div>
  );
}

export function BackOfficeMobileNavigation({
  displayName,
  employeeNumber,
  navigationAccess,
}: {
  displayName: string;
  employeeNumber: string;
  navigationAccess: BackOfficeNavigationAccess;
}) {
  const {
    isMobileNavigationOpen,
    setIsMobileNavigationOpen,
  } = useBackOfficeSidebar();

  return (
    <Dialog.Root modal onOpenChange={setIsMobileNavigationOpen} open={isMobileNavigationOpen}>
      <DialogContent
        aria-label="Back Office navigation"
        className="flex h-dvh max-h-none max-w-[min(22rem,calc(100vw-1rem))] flex-col"
        closeLabel="Close Back Office navigation"
        id="back-office-mobile-navigation"
        side="left"
      >
        <DialogHeader className="shrink-0">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground">
              <CircleUserRound aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle>Back Office</DialogTitle>
              <DialogDescription className="mt-0.5 truncate">{displayName}</DialogDescription>
              <p className="truncate text-xs text-muted-foreground">{employeeNumber}</p>
            </div>
          </div>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 overflow-hidden [&>nav]:!max-h-none [&>nav]:flex-1 [&>nav]:border-0">
          <BackOfficeNavigation
            {...navigationAccess}
            mobile
            onNavigate={() => setIsMobileNavigationOpen(false)}
          />
        </div>
      </DialogContent>
    </Dialog.Root>
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
  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(true);
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);

  useEffect(() => {
    const desktopMediaQuery = window.matchMedia("(min-width: 64rem)");
    const syncViewport = () => {
      setIsDesktopViewport(desktopMediaQuery.matches);

      if (desktopMediaQuery.matches) {
        setIsMobileNavigationOpen(false);
      }
    };

    syncViewport();
    desktopMediaQuery.addEventListener("change", syncViewport);

    return () => desktopMediaQuery.removeEventListener("change", syncViewport);
  }, []);

  const toggleNavigation = () => {
    if (isDesktopViewport) {
      setIsDesktopSidebarCollapsed((current) => !current);
      return;
    }

    setIsMobileNavigationOpen((current) => !current);
  };

  return (
    <BackOfficeNavigationProvider access={navigationAccess}>
      <SidebarContext.Provider
        value={{
          isDesktopSidebarCollapsed,
          isDesktopViewport,
          isMobileNavigationOpen,
          setIsMobileNavigationOpen,
          toggleNavigation,
        }}
      >
        <div className="min-h-svh bg-muted/35 pt-14">
          {header}
          <div
            className={cn(
              "min-h-[calc(100svh-3.5rem)] lg:grid lg:transition-[grid-template-columns] lg:duration-200",
              isDesktopSidebarCollapsed ? "lg:grid-cols-[5rem_minmax(0,1fr)]" : "lg:grid-cols-[16rem_minmax(0,1fr)]",
            )}
          >
            <aside
              aria-label="Back Office sidebar"
              id="back-office-sidebar"
              className="hidden min-w-0 overflow-hidden border-r border-border bg-card print:hidden lg:sticky lg:top-14 lg:flex lg:h-[calc(100svh-3.5rem)] lg:self-start lg:flex-col"
            >
              <div className={cn("border-b border-border", isDesktopSidebarCollapsed ? "grid place-items-center p-3" : "p-4")}>
                {isDesktopSidebarCollapsed ? (
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
              <BackOfficeNavigation {...navigationAccess} collapsed={isDesktopSidebarCollapsed} />
            </aside>

            <div className="min-w-0">{children}</div>
          </div>
        </div>
      </SidebarContext.Provider>
    </BackOfficeNavigationProvider>
  );
}
