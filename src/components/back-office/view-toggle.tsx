"use client";

import { Grid2X2, List } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

export type GridListView = "grid" | "list";

function preferenceKey(scope: string) {
  return `tindio-view-preference:${scope}`;
}

function readPreference(scope: string, fallback: GridListView) {
  try {
    const saved = window.localStorage.getItem(preferenceKey(scope));
    return saved === "grid" || saved === "list" ? saved : fallback;
  } catch {
    return fallback;
  }
}

function subscribeToPreference() {
  return () => {};
}

/**
 * Stores a presentation-only preference in the browser. No records, filters,
 * or permissions change when the selected renderer changes.
 */
export function usePersistedGridListView(scope: string, fallback: GridListView = "grid") {
  const savedView = useSyncExternalStore<GridListView>(
    subscribeToPreference,
    () => readPreference(scope, fallback),
    () => fallback,
  );
  const [sessionView, setSessionView] = useState<GridListView | null>(null);
  const view = sessionView ?? savedView;

  const setView = (nextView: GridListView) => {
    setSessionView(nextView);
    try {
      window.localStorage.setItem(preferenceKey(scope), nextView);
    } catch {
      // Keep the selected view for this session when storage is unavailable.
    }
  };

  return { setView, view };
}

export function GridListViewToggle({
  onChange,
  value,
}: {
  onChange: (view: GridListView) => void;
  value: GridListView;
}) {
  return (
    <div aria-label="Content view" className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1" role="group">
      <Tooltip content="List view">
        <Button
          aria-label="List view"
          aria-pressed={value === "list"}
          onClick={() => onChange("list")}
          size="icon-sm"
          title="List view"
          type="button"
          variant={value === "list" ? "secondary" : "ghost"}
        >
          <List aria-hidden="true" />
        </Button>
      </Tooltip>
      <Tooltip content="Grid view">
        <Button
          aria-label="Grid view"
          aria-pressed={value === "grid"}
          onClick={() => onChange("grid")}
          size="icon-sm"
          title="Grid view"
          type="button"
          variant={value === "grid" ? "secondary" : "ghost"}
        >
          <Grid2X2 aria-hidden="true" />
        </Button>
      </Tooltip>
    </div>
  );
}
