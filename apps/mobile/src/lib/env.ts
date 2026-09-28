const tindioApiUrl = process.env.EXPO_PUBLIC_TINDIO_API_URL?.trim();
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

if (!tindioApiUrl || !supabaseUrl || !supabasePublishableKey) {
  throw new Error("TINDIO Mobile public environment is incomplete.");
}

export const mobileEnvironment = {
  tindioApiUrl: tindioApiUrl.replace(/\/+$/, ""),
  supabaseUrl,
  supabasePublishableKey,
} as const;
