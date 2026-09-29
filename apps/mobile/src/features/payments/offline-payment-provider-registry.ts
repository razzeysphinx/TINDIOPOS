import type {
  OfflinePaymentProviderAdapter,
} from "./offline-payment-provider";

const providers =
  new Map<
    string,
    OfflinePaymentProviderAdapter
  >();

export function registerOfflinePaymentProvider(
  adapter:
    OfflinePaymentProviderAdapter,
) {
  if (
    adapter.capability
    !== "STORE_AND_FORWARD"
  ) {
    throw new Error(
      "Only providers with explicit store-and-forward capability may register for offline electronic payments.",
    );
  }

  if (
    !adapter.providerCode.trim()
  ) {
    throw new Error(
      "Offline payment provider code is required.",
    );
  }

  providers.set(
    adapter.providerCode,
    adapter,
  );
}

export function getOfflinePaymentProvider(
  providerCode: string,
) {
  return (
    providers.get(
      providerCode,
    )
    ?? null
  );
}

export function listOfflinePaymentProviders() {
  return [
    ...providers.keys(),
  ].sort();
}

export function hasOfflinePaymentProvider() {
  return providers.size > 0;
}