"use client";

import { useSyncExternalStore } from "react";

const COMPACT_POS_MEDIA_QUERY = "(max-width: 1023px)";

function subscribeToCompactPosPresentation(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia(COMPACT_POS_MEDIA_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function readCompactPosPresentation() {
  return window.matchMedia(COMPACT_POS_MEDIA_QUERY).matches;
}

/**
 * Keeps the POS state canonical while choosing the appropriate responsive
 * presentation: a desktop side cart or a compact cart review sheet.
 */
export function useCompactPosPresentation() {
  return useSyncExternalStore(
    subscribeToCompactPosPresentation,
    readCompactPosPresentation,
    () => false,
  );
}
