export const tindioDesignTokens = {
  metadata: {
    version: 1,
    brandApproval: "candidate",
  },
  color: {
    brand: {
      primary: "#007A67",
      ink: "#14231F",
      cream: "#F4EFE5",
    },
    surface: {
      app: "#F8F6F0",
      card: "#FFFFFF",
      elevated: "#FFFFFF",
      input: "#FFFFFF",
      overlay: "rgba(20, 35, 31, 0.48)",
    },
    content: {
      primary: "#14231F",
      secondary: "#52645D",
      disabled: "#89938F",
      inverse: "#FFFFFF",
    },
    border: {
      default: "#D9DED9",
      strong: "#AAB5B0",
      focus: "#007A67",
    },
    status: {
      success: { surface: "#E5F5EF", content: "#176B52", border: "#93CFB9" },
      warning: { surface: "#FFF4D6", content: "#76550A", border: "#E7C86C" },
      danger: { surface: "#FDEBE9", content: "#9F2D27", border: "#E9AAA5" },
      information: { surface: "#E8F1FA", content: "#245C87", border: "#A9C9E3" },
      recovering: { surface: "#EEEAFB", content: "#57418A", border: "#C5B8EA" },
      review: { surface: "#FFF0E4", content: "#85491F", border: "#E6B389" },
    },
  },
  typography: {
    role: {
      display: { fontSize: 32, lineHeight: 38, fontWeight: "800" },
      title: { fontSize: 24, lineHeight: 30, fontWeight: "700" },
      section: { fontSize: 18, lineHeight: 24, fontWeight: "700" },
      body: { fontSize: 16, lineHeight: 24, fontWeight: "400" },
      label: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
      caption: { fontSize: 12, lineHeight: 18, fontWeight: "500" },
      numeric: { fontSize: 20, lineHeight: 26, fontWeight: "700" },
    },
  },
  space: { none: 0, xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 40 },
  radius: { none: 0, sm: 8, md: 12, lg: 16, pill: 999 },
  elevation: {
    none: { elevation: 0, shadowOpacity: 0 },
    card: { elevation: 2, shadowOpacity: 0.08 },
    overlay: { elevation: 8, shadowOpacity: 0.16 },
  },
  icon: { size: { sm: 16, md: 20, lg: 24, xl: 32 } },
  target: { minimum: 48 },
  motion: { duration: { none: 0, fast: 120, standard: 200, deliberate: 320 } },
} as const;

export type TindioStatusTone = keyof typeof tindioDesignTokens.color.status;
