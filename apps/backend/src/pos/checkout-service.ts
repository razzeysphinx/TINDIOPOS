import type { OwnedCheckoutDependencies } from "./checkout-owned.js";
import { handleOwnedCheckout } from "./checkout-owned.js";
import { proxyCheckout } from "./checkout-proxy.js";

type CheckoutServiceOptions = {
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedCheckoutDependencies;
};

function configurationFailure(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json(
    { ok: false, reason: "CHECKOUT_BACKEND_UNAVAILABLE", requestId },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

export async function serveCheckout(
  request: Request,
  options: CheckoutServiceOptions,
): Promise<Response> {
  const mode = options.mode ?? "owned";
  if (mode === "proxy") {
    return proxyCheckout(request, {
      upstreamOrigin: options.upstreamOrigin,
      createRequestId: options.createRequestId,
    });
  }
  if (mode !== "owned") return configurationFailure(options.createRequestId);
  try {
    return await handleOwnedCheckout(request, options.createOwnedDependencies());
  } catch {
    return configurationFailure(options.createRequestId);
  }
}
