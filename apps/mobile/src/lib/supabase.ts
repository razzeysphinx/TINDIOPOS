import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import { mobileEnvironment } from "./env";
import { secureStorage } from "./secure-storage";

export const supabase = createClient(mobileEnvironment.supabaseUrl, mobileEnvironment.supabasePublishableKey, {
  auth: { storage: secureStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
