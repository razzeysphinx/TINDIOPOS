import type { OwnedCustomersDependencies } from "./customers-owned.js";
import { handleOwnedPosCustomers } from "./customers-owned.js";
import { proxyPosCustomers } from "./customers-proxy.js";

type CustomersServiceOptions = {
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedCustomersDependencies;
};

function configurationFailure(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json(
    { ok: false, reason: "CUSTOMERS_BACKEND_UNAVAILABLE", requestId },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

export async function servePosCustomers(
  request: Request,
  options: CustomersServiceOptions,
): Promise<Response> {
  const mode = options.mode ?? "owned";

  if (mode === "proxy") {
    return proxyPosCustomers(request, {
      upstreamOrigin: options.upstreamOrigin,
      createRequestId: options.createRequestId,
    });
  }
  if (mode !== "owned") return configurationFailure(options.createRequestId);

  try {
    return await handleOwnedPosCustomers(
      request,
      options.createOwnedDependencies(),
    );
  } catch {
    return configurationFailure(options.createRequestId);
  }
}
