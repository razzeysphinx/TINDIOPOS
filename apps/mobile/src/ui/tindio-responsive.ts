import { useWindowDimensions } from "react-native";

export type TindioViewportClass =
  | "compact-phone"
  | "standard-phone"
  | "compact-tablet"
  | "tablet";

export type TindioResponsiveLayout = {
  allowsColumns: boolean;
  allowsDenseGrid: boolean;
  fontScale: number;
  isLandscape: boolean;
  isLargeText: boolean;
  viewportClass: TindioViewportClass;
};

export const TINDIO_VIEWPORT_BREAKPOINTS = {
  compactPhoneMax: 359,
  standardPhoneMax: 599,
  compactTabletMax: 899,
} as const;

export const TINDIO_LARGE_TEXT_MIN_SCALE = 1.3;

export function classifyTindioViewport(width: number): TindioViewportClass {
  if (width <= TINDIO_VIEWPORT_BREAKPOINTS.compactPhoneMax) return "compact-phone";
  if (width <= TINDIO_VIEWPORT_BREAKPOINTS.standardPhoneMax) return "standard-phone";
  if (width <= TINDIO_VIEWPORT_BREAKPOINTS.compactTabletMax) return "compact-tablet";
  return "tablet";
}

export function getTindioResponsiveLayout({
  fontScale,
  height,
  width,
}: {
  fontScale: number;
  height: number;
  width: number;
}): TindioResponsiveLayout {
  const isLargeText = fontScale >= TINDIO_LARGE_TEXT_MIN_SCALE;

  return {
    allowsColumns: width >= 720 && !isLargeText,
    allowsDenseGrid: width >= 600 && !isLargeText,
    fontScale,
    isLandscape: width > height,
    isLargeText,
    viewportClass: classifyTindioViewport(width),
  };
}

export function useTindioResponsiveLayout(): TindioResponsiveLayout {
  const { fontScale, height, width } = useWindowDimensions();
  return getTindioResponsiveLayout({ fontScale, height, width });
}
