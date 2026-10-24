import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import { supabaseMobileAuthStorageKey } from "../features/session/auth-storage-keys";
import { mobileEnvironment } from "./env";
import { secureStorage } from "./secure-storage";

export const SUPABASE_MOBILE_AUTH_STORAGE_KEY =
  supabaseMobileAuthStorageKey(mobileEnvironment.supabaseUrl);

export const supabase = createClient(mobileEnvironment.supabaseUrl, mobileEnvironment.supabasePublishableKey, {
  auth: {
    storage: secureStorage,
    storageKey: SUPABASE_MOBILE_AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
