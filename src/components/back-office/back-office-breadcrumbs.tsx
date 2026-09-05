"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { getBackOfficeBreadcrumbs, type BackOfficeBreadcrumb } from "@/components/back-office/back-office-navigation";
import { useBackOfficeNavigationAccess } from "@/components/back-office/back-office-navigation-context";

export function BackOfficeBreadcrumbs({
  currentLabel,
  items: providedItems,
}: {
  currentLabel: string;
  /** Lets a query-driven workspace expose its meaningful hierarchy without changing its canonical route. */
  items?: readonly BackOfficeBreadcrumb[];
}) {
  const pathname = usePathname();
  const access = useBackOfficeNavigationAccess();
  const items = providedItems ?? getBackOfficeBreadcrumbs(pathname, currentLabel, access);

  if (items.length < 2) return null;

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground sm:text-sm">
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;

          return (
            <li className="flex min-w-0 items-center gap-1.5" key={`${item.href ?? "current"}-${item.label}`}>
              {index > 0 ? <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" /> : null}
              {item.href && !isCurrent ? (
                <Link className="truncate transition-colors hover:text-foreground focus-visible:outline-none focus-visible:underline" href={item.href}>
                  {item.label}
                </Link>
              ) : (
                <span aria-current={isCurrent ? "page" : undefined} className="truncate">
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
