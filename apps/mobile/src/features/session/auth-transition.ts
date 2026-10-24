import type { TindioAuthProvider } from "@tindio/contracts/auth";

type AuthTransitionStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export const MOBILE_AUTH_PROVIDER_MARKER_KEY =
  "tindio.auth.last-verified-provider.v1";

export type MobileAuthTransitionState =
  | "SUPABASE_ACTIVE"
  | "NEON_ACTIVE"
  | "NEON_REAUTHENTICATION_REQUIRED"
  | "SIGN_IN_REQUIRED";

export type MobileAuthTransitionSnapshot = {
  targetProvider: TindioAuthProvider;
  state: MobileAuthTransitionState;
  lastVerifiedProvider: TindioAuthProvider | null;
  legacySupabaseSessionPresent: boolean;
  neonSessionPresent: boolean;
  preservesLegacySession: true;
  preservesFinancialCustody: true;
};

function storedProvider(value: string | null): TindioAuthProvider | null {
  return value === "supabase" || value === "neon" ? value : null;
}

export async function inspectMobileAuthTransition({
  neonStorageKey,
  storage,
  supabaseStorageKey,
  targetProvider,
}: {
  neonStorageKey: string;
  storage: AuthTransitionStorage;
  supabaseStorageKey: string;
  targetProvider: TindioAuthProvider;
}): Promise<MobileAuthTransitionSnapshot> {
  const [legacySupabaseSession, neonSession, lastVerifiedProvider] =
    await Promise.all([
      storage.getItem(supabaseStorageKey),
      storage.getItem(neonStorageKey),
      storage.getItem(MOBILE_AUTH_PROVIDER_MARKER_KEY),
    ]);
  const legacySupabaseSessionPresent = Boolean(legacySupabaseSession);
  const neonSessionPresent = Boolean(neonSession);

  let state: MobileAuthTransitionState = "SIGN_IN_REQUIRED";
  if (targetProvider === "supabase" && legacySupabaseSessionPresent) {
    state = "SUPABASE_ACTIVE";
  } else if (targetProvider === "neon" && neonSessionPresent) {
    state = "NEON_ACTIVE";
  } else if (targetProvider === "neon" && legacySupabaseSessionPresent) {
    state = "NEON_REAUTHENTICATION_REQUIRED";
  }

  return {
    targetProvider,
    state,
    lastVerifiedProvider: storedProvider(lastVerifiedProvider),
    legacySupabaseSessionPresent,
    neonSessionPresent,
    preservesLegacySession: true,
    preservesFinancialCustody: true,
  };
}

export async function recordVerifiedMobileAuthProvider({
  provider,
  storage,
}: {
  provider: TindioAuthProvider;
  storage: AuthTransitionStorage;
}) {
  await storage.setItem(MOBILE_AUTH_PROVIDER_MARKER_KEY, provider);
}

export function canRetireInactiveMobileAuthSession({
  activeIdentityVerified,
  custodyReleasable,
  ownerApproved,
  snapshot,
}: {
  activeIdentityVerified: boolean;
  custodyReleasable: boolean;
  ownerApproved: boolean;
  snapshot: MobileAuthTransitionSnapshot;
}) {
  return snapshot.targetProvider === "neon"
    && snapshot.state === "NEON_ACTIVE"
    && snapshot.legacySupabaseSessionPresent
    && activeIdentityVerified
    && custodyReleasable
    && ownerApproved;
}
