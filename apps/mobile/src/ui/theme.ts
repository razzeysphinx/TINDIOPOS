import { tindioDesignTokens } from "@tindio/contracts/ui";

export const tindioTheme = {
  ...tindioDesignTokens,
  shadow: {
    card: {
      elevation: tindioDesignTokens.elevation.card.elevation,
      shadowColor: tindioDesignTokens.color.brand.ink,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: tindioDesignTokens.elevation.card.shadowOpacity,
      shadowRadius: 6,
    },
    overlay: {
      elevation: tindioDesignTokens.elevation.overlay.elevation,
      shadowColor: tindioDesignTokens.color.brand.ink,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: tindioDesignTokens.elevation.overlay.shadowOpacity,
      shadowRadius: 16,
    },
  },
} as const;

export type TindioTheme = typeof tindioTheme;
