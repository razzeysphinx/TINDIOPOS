"use client";

export type PosAppearance = "light" | "dark" | "system";
export type PosItemLayout = "grid" | "list";

export type PosWorkspacePreferences = {
  appearance: PosAppearance;
  itemLayout: PosItemLayout;
  language: string;
  scannerEnabled: boolean;
};

const defaults: PosWorkspacePreferences = {
  appearance: "system",
  itemLayout: "grid",
  language: "en-PH",
  scannerEnabled: true,
};

function key(scope: string) {
  return `tindio-pos-preferences:${scope}`;
}

function resolvedDarkMode(appearance: PosAppearance) {
  return appearance === "dark" || (
    appearance === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function readPosWorkspacePreferences(scope: string): PosWorkspacePreferences {
  if (typeof window === "undefined") return defaults;

  try {
    const raw = window.localStorage.getItem(key(scope));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<PosWorkspacePreferences>;
    return {
      appearance: parsed.appearance === "light" || parsed.appearance === "dark" || parsed.appearance === "system"
        ? parsed.appearance
        : defaults.appearance,
      itemLayout: parsed.itemLayout === "list" ? "list" : "grid",
      language: typeof parsed.language === "string" ? parsed.language : defaults.language,
      scannerEnabled: parsed.scannerEnabled !== false,
    };
  } catch {
    return defaults;
  }
}

export function writePosWorkspacePreferences(scope: string, preferences: PosWorkspacePreferences) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(key(scope), JSON.stringify(preferences));
  document.documentElement.classList.toggle("dark", resolvedDarkMode(preferences.appearance));
  window.dispatchEvent(new CustomEvent("tindio-pos-preferences", { detail: { scope } }));
}
