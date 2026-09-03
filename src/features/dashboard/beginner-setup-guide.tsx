import { CheckCircle2, Circle, ChevronRight } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { BeginnerSetupItem } from "@/features/dashboard/beginner-setup-types";

export type { BeginnerSetupItem } from "@/features/dashboard/beginner-setup-types";

/**
 * A guide only renders when real organization records indicate setup is still
 * incomplete. It sends people to their established workflow; it never writes
 * setup state or invents a second onboarding system.
 */
export function BeginnerSetupGuide({ items }: { items: BeginnerSetupItem[] }) {
  const completedCount = items.filter((item) => item.complete).length;

  if (completedCount === items.length) return null;

  return (
    <details className="group rounded-xl border bg-card" open>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 marker:hidden sm:px-5">
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-[0.14em] text-primary uppercase">Getting started</p>
          <h2 className="mt-1 text-lg font-semibold">Get your business ready</h2>
          <p className="mt-1 text-sm text-muted-foreground">Complete the essentials before your first sale.</p>
        </div>
        <Badge className="shrink-0" variant="secondary">{completedCount} of {items.length}</Badge>
      </summary>
      <div className="border-t px-4 py-3 sm:px-5 sm:py-4">
        <ul className="grid gap-2">
          {items.map((item) => (
            <li key={item.label}>
              <Link
                className="flex min-h-12 items-center justify-between gap-3 rounded-lg px-2 py-2 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                href={item.href}
              >
                <span className="flex min-w-0 items-start gap-3">
                  {item.complete ? (
                    <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
                  ) : (
                    <Circle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{item.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{item.description}</span>
                  </span>
                </span>
                {item.complete ? (
                  <span className="shrink-0 text-xs font-medium text-primary">Done</span>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary">Continue <ChevronRight aria-hidden="true" className="size-3.5" /></span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
