export const NEON_MOBILE_AUTH_COOKIE_KEY =
  "tindio.auth.neon.session-cookie.v1";

export function supabaseMobileAuthStorageKey(supabaseUrl: string) {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}
