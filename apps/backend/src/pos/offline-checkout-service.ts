import type { OwnedOfflineCheckoutDependencies } from "./offline-checkout-owned.js";
import { handleOwnedOfflineCheckout } from "./offline-checkout-owned.js";
import { proxyOfflineCheckout } from "./offline-checkout-proxy.js";

type OfflineCheckoutServiceOptions = {
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedOfflineCheckoutDependencies;
};

function configurationFailure(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json(
    { ok: false, reason: "OFFLINE_CHECKOUT_BACKEND_UNAVAILABLE", requestId },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

export async function serveOfflineCheckout(
  request: Request,
  options: OfflineCheckoutServiceOptions,
): Promise<Response> {
  const mode = options.mode ?? "owned";
  if (mode === "proxy") {
    return proxyOfflineCheckout(request, {
      upstreamOrigin: options.upstreamOrigin,
      createRequestId: options.createRequestId,
    });
  }
  if (mode !== "owned") return configurationFailure(options.createRequestId);
  try {
    return await handleOwnedOfflineCheckout(request, options.createOwnedDependencies());
  } catch {
    return configurationFailure(options.createRequestId);
  }
}
