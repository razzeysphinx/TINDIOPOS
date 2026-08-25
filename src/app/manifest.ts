import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TINDIO — Sell simple. Grow smarter.",
    short_name: "TINDIO",
    description: "TINDIO point of sale for growing businesses.",
    start_url: "/pos",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#6d28d9",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
