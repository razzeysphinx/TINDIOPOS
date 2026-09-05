import type { ReactNode } from "react";

import { DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const drawerWidths = {
  compact: "sm:max-w-xl",
  standard: "sm:max-w-[40rem]",
  wide: "sm:max-w-[42rem]",
} as const;

/**
 * Shared shell for Back Office record detail drawers. It deliberately only
 * standardizes geometry and dialog behavior; each workspace owns its data,
 * loading state, focus restoration, and actions.
 */
export function BackOfficeDetailDrawer({
  children,
  className,
  closeLabel,
  nonBlocking = false,
  width = "standard",
}: {
  children: ReactNode;
  className?: string;
  closeLabel: string;
  nonBlocking?: boolean;
  width?: keyof typeof drawerWidths;
}) {
  return (
    <DialogContent
      className={cn(
        "flex h-dvh max-h-none max-w-none flex-col rounded-none",
        drawerWidths[width],
        className,
      )}
      closeLabel={closeLabel}
      nonBlocking={nonBlocking}
      side="right"
    >
      {children}
    </DialogContent>
  );
}
