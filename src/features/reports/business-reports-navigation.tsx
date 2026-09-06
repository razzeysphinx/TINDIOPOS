"use client";

import Link from "next/link";

import {
  businessReportSectionLabels,
  businessReportSections,
  type BusinessReportSection,
} from "@/features/reports/report-sections";
import { cn } from "@/lib/utils";

export function BusinessReportsNavigation({
  activeSection,
  filterQuery,
}: {
  activeSection: BusinessReportSection;
  filterQuery: string;
}) {
  return (
    <nav aria-label="Business report sections" className="overflow-x-auto rounded-xl border bg-card p-1.5">
      <div className="flex min-w-max gap-1" role="list">
        {businessReportSections.map((section) => {
          const active = section === activeSection;
          const query = new URLSearchParams(filterQuery);
          query.set("section", section);
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              href={`/back-office/reports?${query.toString()}`}
              key={section}
              role="listitem"
            >
              {businessReportSectionLabels[section]}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
