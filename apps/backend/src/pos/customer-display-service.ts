import type { OwnedCustomerDisplayDependencies } from "./customer-display-owned.js";
import { handleOwnedCustomerDisplayUpdate } from "./customer-display-owned.js";
import { proxyCustomerDisplayUpdate } from "./customer-display-proxy.js";

type CustomerDisplayServiceOptions = {
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedCustomerDisplayDependencies;
};

function configurationFailure(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json(
    { ok: false, reason: "CUSTOMER_DISPLAY_BACKEND_UNAVAILABLE", requestId },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

export async function serveCustomerDisplayUpdate(
  request: Request,
  options: CustomerDisplayServiceOptions,
): Promise<Response> {
  const mode = options.mode ?? "owned";
  if (mode === "proxy") {
    return proxyCustomerDisplayUpdate(request, {
      upstreamOrigin: options.upstreamOrigin,
      createRequestId: options.createRequestId,
    });
  }
  if (mode !== "owned") return configurationFailure(options.createRequestId);

  try {
    return await handleOwnedCustomerDisplayUpdate(
      request,
      options.createOwnedDependencies(),
    );
  } catch {
    return configurationFailure(options.createRequestId);
  }
}
