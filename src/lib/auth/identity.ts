import { createClient } from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export async function resolveCurrentProfileId(
  supabase: ServerSupabaseClient,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("current_profile_id");

  if (error || typeof data !== "string" || data.length === 0) {
    return null;
  }

  return data;
}
