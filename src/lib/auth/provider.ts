import {
  resolveTindioAuthProvider,
  type TindioAuthProvider,
} from "@tindio/contracts/auth";

export function resolveWebAuthProvider(
  configuredProvider: string | null | undefined,
): TindioAuthProvider {
  return resolveTindioAuthProvider(configuredProvider, ["supabase"]);
}
