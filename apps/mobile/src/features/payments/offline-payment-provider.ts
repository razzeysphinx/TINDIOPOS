export type OfflinePaymentProviderCapability =
  | "ONLINE_ONLY"
  | "STORE_AND_FORWARD";

export type OfflineElectronicPaymentRequest = {
  operationId: string;
  amountMinor: number;
  currencyCode: string;
};

export type OfflineElectronicPaymentAuthorization =
  | {
      ok: true;
      providerCode: string;
      providerReference: string;
      approvedAmountMinor: number;
      capturedAt: string;
      settlementState:
        | "PROVIDER_QUEUED"
        | "PROVIDER_APPROVED_OFFLINE";
    }
  | {
      ok: false;
      code:
        | "PROVIDER_UNAVAILABLE"
        | "PROVIDER_DECLINED"
        | "PROVIDER_OFFLINE_NOT_SUPPORTED"
        | "PROVIDER_ERROR";
      message: string;
    };

export interface OfflinePaymentProviderAdapter {
  readonly providerCode: string;

  readonly capability:
    OfflinePaymentProviderCapability;

  authorizeOffline(
    request:
      OfflineElectronicPaymentRequest,
  ): Promise<
    OfflineElectronicPaymentAuthorization
  >;
}

export function providerSupportsStoreAndForward(
  adapter:
    OfflinePaymentProviderAdapter,
) {
  return adapter.capability
    === "STORE_AND_FORWARD";
}