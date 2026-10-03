const tindioApiUrl =
  process.env
    .EXPO_PUBLIC_TINDIO_API_URL
    ?.trim();

const supabaseUrl =
  process.env
    .EXPO_PUBLIC_SUPABASE_URL
    ?.trim();

const supabasePublishableKey =
  process.env
    .EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?.trim();

if (
  !tindioApiUrl
  || !supabaseUrl
  || !supabasePublishableKey
) {
  throw new Error(
    "TINDIO Mobile public environment is incomplete.",
  );
}

const isProductionBuild =
  process.env.EAS_BUILD_PROFILE
  === "production";

function normalizedUrl(
  value: string,
  name: string,
) {
  const url =
    new URL(value);

  if (
    isProductionBuild
    && url.protocol !== "https:"
  ) {
    throw new Error(
      `${name} must use HTTPS in production.`,
    );
  }

  return value.replace(
    /\/+$/,
    "",
  );
}

export const mobileEnvironment = {
  tindioApiUrl:
    normalizedUrl(
      tindioApiUrl,
      "EXPO_PUBLIC_TINDIO_API_URL",
    ),

  supabaseUrl:
    normalizedUrl(
      supabaseUrl,
      "EXPO_PUBLIC_SUPABASE_URL",
    ),

  supabasePublishableKey,
} as const;