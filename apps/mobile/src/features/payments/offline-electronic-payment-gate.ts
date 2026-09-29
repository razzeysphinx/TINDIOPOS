import {
  getOfflinePaymentProvider,
} from "./offline-payment-provider-registry";
import {
  evaluateOfflineElectronicRisk,
  failClosedOfflineElectronicPolicy,
  type OfflineElectronicRiskPolicy,
} from "./offline-payment-risk";

export type OfflineElectronicPaymentGateInput = {
  providerCode: string | null;
  amountMinor: number;
  currentExposureMinor: number;
  offlineDurationMinutes: number;
  managerApprovalAvailable: boolean;
  policy?:
    OfflineElectronicRiskPolicy;
};

export function evaluateOfflineElectronicPaymentGate(
  input:
    OfflineElectronicPaymentGateInput,
) {
  const provider =
    input.providerCode
      ? getOfflinePaymentProvider(
          input.providerCode,
        )
      : null;

  const policy =
    input.policy
    ?? failClosedOfflineElectronicPolicy;

  return evaluateOfflineElectronicRisk(
    policy,
    {
      amountMinor:
        input.amountMinor,
      currentExposureMinor:
        input.currentExposureMinor,
      offlineDurationMinutes:
        input.offlineDurationMinutes,
      providerSupportsStoreAndForward:
        provider?.capability
          === "STORE_AND_FORWARD",
      managerApprovalAvailable:
        input.managerApprovalAvailable,
    },
  );
}