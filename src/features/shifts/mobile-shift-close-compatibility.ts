import type {
  PosClientUpgradeRequiredResponse,
} from "@/contracts/pos";

export const MOBILE_SHIFT_CUSTODY_CAPABILITY =
  "SHIFT_CUSTODY_FINALIZATION_V1" as const;

export type MobileShiftCloseUpgradeRequired =
  PosClientUpgradeRequiredResponse;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value);
}

export function legacyMobileShiftCloseUpgrade(
  input: unknown,
): MobileShiftCloseUpgradeRequired | null {
  if (!record(input)) return null;

  const isLegacyShape =
    typeof input.shiftId === "string"
    && typeof input.countedCash === "string"
    && !("device" in input)
    && !("localHighWater" in input)
    && !("finalizationToken" in input);

  if (!isLegacyShape) return null;

  return {
    ok: false,
    code: "POS_CLIENT_UPGRADE_REQUIRED",
    requiredCapability: MOBILE_SHIFT_CUSTODY_CAPABILITY,
    retryable: false,
    preservesRecovery: true,
    message:
      "Update TINDIO POS before closing this shift. The shift remains open and pending transactions are preserved.",
  };
}

export function isMobileShiftCloseUpgradeRequired(
  value: unknown,
): value is MobileShiftCloseUpgradeRequired {
  return record(value)
    && value.code === "POS_CLIENT_UPGRADE_REQUIRED";
}
