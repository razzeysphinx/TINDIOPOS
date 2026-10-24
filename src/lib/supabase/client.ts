import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/supabase/database.types";
import { resolveWebAuthProvider } from "@/lib/auth/provider";
import { getPublicEnvironment } from "@/lib/supabase/env";

export function createClient() {
  resolveWebAuthProvider(
    process.env.NEXT_PUBLIC_TINDIO_AUTH_PROVIDER,
  );

  const environment = getPublicEnvironment();

  return createBrowserClient<Database>(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
