import type { TindioAuthProvider } from "./auth";

export const TINDIO_CLIENT_VERSION_HEADER = "x-tindio-client-version" as const;
export const TINDIO_CLIENT_CAPABILITIES_HEADER = "x-tindio-client-capabilities" as const;
export const TINDIO_AUTH_PROVIDER_HEADER = "x-tindio-auth-provider" as const;

export const TINDIO_AUTH_CLIENT_CAPABILITIES = {
  legacySupabaseSession: "LEGACY_SUPABASE_SESSION_V1",
  dualAuthTransition: "DUAL_AUTH_TRANSITION_V1",
  offlineCustody: "OFFLINE_CUSTODY_V1",
  authCutoverRollback: "AUTH_CUTOVER_ROLLBACK_V1",
} as const;

export const TINDIO_CURRENT_AUTH_CLIENT_CAPABILITIES = [
  TINDIO_AUTH_CLIENT_CAPABILITIES.legacySupabaseSession,
  TINDIO_AUTH_CLIENT_CAPABILITIES.dualAuthTransition,
  TINDIO_AUTH_CLIENT_CAPABILITIES.offlineCustody,
  TINDIO_AUTH_CLIENT_CAPABILITIES.authCutoverRollback,
] as const;

export type AuthClientCompatibilityMode =
  | "supabase-compatibility"
  | "dual-transition"
  | "neon-required";

export type AuthClientCompatibilityDecision = {
  status: "SUPPORTED_LEGACY" | "SUPPORTED_TRANSITION" | "UPGRADE_REQUIRED";
  requiredAuthProvider: TindioAuthProvider;
  sellingAllowed: boolean;
  custodyRecoveryAllowed: true;
  preservesRecovery: true;
  requiredCapability: typeof TINDIO_AUTH_CLIENT_CAPABILITIES.dualAuthTransition | null;
};

export type AuthClientUpgradeRequiredResponse = {
  ok: false;
  code: "POS_CLIENT_UPGRADE_REQUIRED";
  requiredCapability: typeof TINDIO_AUTH_CLIENT_CAPABILITIES.dualAuthTransition;
  retryable: false;
  preservesRecovery: true;
  message: string;
};

export function serializeAuthClientCapabilities(capabilities: readonly string[]) {
  return capabilities.join(",");
}

export function parseAuthClientCapabilities(value: string | null) {
  if (!value) return [];
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

export function evaluateAuthClientCompatibility({
  capabilities,
  legacyWindowOpen,
  mode,
}: {
  capabilities: readonly string[];
  legacyWindowOpen: boolean;
  mode: AuthClientCompatibilityMode;
}): AuthClientCompatibilityDecision {
  const transitionCapable = capabilities.includes(
    TINDIO_AUTH_CLIENT_CAPABILITIES.dualAuthTransition,
  );

  if (mode === "supabase-compatibility") {
    return {
      status: transitionCapable ? "SUPPORTED_TRANSITION" : "SUPPORTED_LEGACY",
      requiredAuthProvider: "supabase",
      sellingAllowed: true,
      custodyRecoveryAllowed: true,
      preservesRecovery: true,
      requiredCapability: null,
    };
  }

  if (transitionCapable) {
    return {
      status: "SUPPORTED_TRANSITION",
      requiredAuthProvider: mode === "neon-required" ? "neon" : "supabase",
      sellingAllowed: true,
      custodyRecoveryAllowed: true,
      preservesRecovery: true,
      requiredCapability: null,
    };
  }

  if (mode === "dual-transition" && legacyWindowOpen) {
    return {
      status: "SUPPORTED_LEGACY",
      requiredAuthProvider: "supabase",
      sellingAllowed: true,
      custodyRecoveryAllowed: true,
      preservesRecovery: true,
      requiredCapability: null,
    };
  }

  return {
    status: "UPGRADE_REQUIRED",
    requiredAuthProvider: "neon",
    sellingAllowed: false,
    custodyRecoveryAllowed: true,
    preservesRecovery: true,
    requiredCapability: TINDIO_AUTH_CLIENT_CAPABILITIES.dualAuthTransition,
  };
}

export function authClientUpgradeRequiredResponse(
  decision: AuthClientCompatibilityDecision,
): AuthClientUpgradeRequiredResponse | null {
  if (decision.status !== "UPGRADE_REQUIRED" || !decision.requiredCapability) return null;

  return {
    ok: false,
    code: "POS_CLIENT_UPGRADE_REQUIRED",
    requiredCapability: decision.requiredCapability,
    retryable: false,
    preservesRecovery: true,
    message: "Update TINDIO POS to continue selling. Your session and locally saved transactions remain preserved for recovery.",
  };
}
