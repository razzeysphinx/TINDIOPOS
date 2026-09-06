import type { ReactNode } from "react";

import { BackOfficeBreadcrumbs } from "@/components/back-office/back-office-breadcrumbs";
import type { BackOfficeBreadcrumb } from "@/components/back-office/back-office-navigation";

export function PageHeader({
  title,
  description,
  action,
  breadcrumbs,
  showDescription = false,
  showTitle = false,
}: {
  /** Legacy page context is now represented by the breadcrumb and H1. */
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
  breadcrumbs?: readonly BackOfficeBreadcrumb[];
  /** Render contextual copy only when it adds information beyond the app bar and breadcrumb. */
  showDescription?: boolean;
  /** Detail pages can expose their record title when it differs from the app-bar page name. */
  showTitle?: boolean;
}) {
  const visibleDescription = showDescription && description.trim().length > 0;

  return (
    <header className="space-y-4">
      <BackOfficeBreadcrumbs currentLabel={title} items={breadcrumbs} />
      {showTitle ? (
        <h1 className="break-words text-balance text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">{title}</h1>
      ) : (
        <h1 className="sr-only">{title}</h1>
      )}
      {visibleDescription || action ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          {visibleDescription ? (
            <p className="max-w-3xl break-words text-pretty text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          ) : null}
          {action ? <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">{action}</div> : null}
        </div>
      ) : null}
    </header>
  );
}
