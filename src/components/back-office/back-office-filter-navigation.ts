"use client";

import { useCallback, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

type QueryValue = string | null | undefined;

/**
 * Keeps Back Office filter controls URL-driven without giving each page its
 * own navigation implementation. Server pages remain the authority for
 * filtering; this only updates the existing query-string contract.
 */
export function useBackOfficeFilterNavigation(action?: string) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const updateFilters = useCallback((updates: Record<string, QueryValue>) => {
    const target = action ?? pathname;
    const current = new URLSearchParams(window.location.search);

    // Cursor pagination must restart whenever the visible filter changes.
    current.delete("before");

    for (const [name, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      if (value === null || value.trim() === "") current.delete(name);
      else current.set(name, value);
    }

    const query = current.toString();
    startTransition(() => router.replace(query ? `${target}?${query}` : target, { scroll: false }));
  }, [action, pathname, router]);

  return { isPending, updateFilters };
}
