import type { ReactNode } from "react";

import { BackOfficeBreadcrumbs } from "@/components/back-office/back-office-breadcrumbs";
import type { BackOfficeBreadcrumb } from "@/components/back-office/back-office-navigation";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  breadcrumbs,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
  breadcrumbs?: readonly BackOfficeBreadcrumb[];
}) {
  return (
    <header className="space-y-4">
      <BackOfficeBreadcrumbs currentLabel={title} items={breadcrumbs} />
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-xs font-bold tracking-[0.14em] text-primary uppercase">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="mt-1 break-words text-balance text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">{title}</h1>
          <p className="mt-2 max-w-3xl break-words text-pretty text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
        {action ? <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">{action}</div> : null}
      </div>
    </header>
  );
}
