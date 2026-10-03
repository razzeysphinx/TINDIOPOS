export type OfflineElectronicRiskPolicy = {
  electronicOfflineAllowed: boolean;
  maxTransactionMinor: number;
  maxTotalOfflineExposureMinor: number;
  maxOfflineDurationMinutes: number;
  managerApprovalThresholdMinor: number | null;
};

export type OfflineElectronicRiskInput = {
  amountMinor: number;
  currentExposureMinor: number;
  offlineDurationMinutes: number;
  providerSupportsStoreAndForward: boolean;
  managerApprovalAvailable: boolean;
};

export type OfflineElectronicRiskDecision =
  | {
      ok: true;
      decision: "ALLOW";
      projectedExposureMinor: number;
    }
  | {
      ok: false;
      decision:
        | "ELECTRONIC_OFFLINE_DISABLED"
        | "PROVIDER_STORE_AND_FORWARD_REQUIRED"
        | "INVALID_AMOUNT"
        | "TRANSACTION_LIMIT_EXCEEDED"
        | "EXPOSURE_LIMIT_EXCEEDED"
        | "OFFLINE_DURATION_EXCEEDED"
        | "MANAGER_APPROVAL_REQUIRED";
      message: string;
      projectedExposureMinor: number;
    };

export const failClosedOfflineElectronicPolicy:
  OfflineElectronicRiskPolicy = {
    electronicOfflineAllowed: false,
    maxTransactionMinor: 0,
    maxTotalOfflineExposureMinor: 0,
    maxOfflineDurationMinutes: 0,
    managerApprovalThresholdMinor: null,
  };

export function evaluateOfflineElectronicRisk(
  policy: OfflineElectronicRiskPolicy,
  input: OfflineElectronicRiskInput,
): OfflineElectronicRiskDecision {
  const projectedExposureMinor =
    input.currentExposureMinor
    + input.amountMinor;

  if (
    !Number.isSafeInteger(
      input.amountMinor,
    )
    || input.amountMinor <= 0
  ) {
    return {
      ok: false,
      decision: "INVALID_AMOUNT",
      message:
        "Offline electronic payment amount is invalid.",
      projectedExposureMinor,
    };
  }

  if (
    !Number.isSafeInteger(
      input.currentExposureMinor,
    )
    || input.currentExposureMinor < 0
    || !Number.isFinite(
      input.offlineDurationMinutes,
    )
    || input.offlineDurationMinutes < 0
  ) {
    return {
      ok: false,
      decision: "INVALID_AMOUNT",
      message:
        "Offline electronic payment risk state is invalid.",
      projectedExposureMinor,
    };
  }

  if (!policy.electronicOfflineAllowed) {
    return {
      ok: false,
      decision:
        "ELECTRONIC_OFFLINE_DISABLED",
      message:
        "Electronic offline payments are disabled.",
      projectedExposureMinor,
    };
  }

  if (
    !input.providerSupportsStoreAndForward
  ) {
    return {
      ok: false,
      decision:
        "PROVIDER_STORE_AND_FORWARD_REQUIRED",
      message:
        "The configured payment provider does not support compliant store-and-forward.",
      projectedExposureMinor,
    };
  }

  if (
    policy.maxTransactionMinor <= 0
    || input.amountMinor
      > policy.maxTransactionMinor
  ) {
    return {
      ok: false,
      decision:
        "TRANSACTION_LIMIT_EXCEEDED",
      message:
        "This transaction exceeds the offline electronic payment limit.",
      projectedExposureMinor,
    };
  }

  if (
    policy.maxTotalOfflineExposureMinor
      <= 0
    || projectedExposureMinor
      > policy.maxTotalOfflineExposureMinor
  ) {
    return {
      ok: false,
      decision:
        "EXPOSURE_LIMIT_EXCEEDED",
      message:
        "The store has reached its maximum offline electronic payment exposure.",
      projectedExposureMinor,
    };
  }

  if (
    policy.maxOfflineDurationMinutes
      <= 0
    || input.offlineDurationMinutes
      > policy.maxOfflineDurationMinutes
  ) {
    return {
      ok: false,
      decision:
        "OFFLINE_DURATION_EXCEEDED",
      message:
        "The terminal has been offline longer than the electronic payment policy allows.",
      projectedExposureMinor,
    };
  }

  if (
    policy.managerApprovalThresholdMinor
      !== null
    && input.amountMinor
      >= policy.managerApprovalThresholdMinor
    && !input.managerApprovalAvailable
  ) {
    return {
      ok: false,
      decision:
        "MANAGER_APPROVAL_REQUIRED",
      message:
        "This offline electronic payment requires a compliant manager approval path that is not currently available offline.",
      projectedExposureMinor,
    };
  }

  return {
    ok: true,
    decision: "ALLOW",
    projectedExposureMinor,
  };
}