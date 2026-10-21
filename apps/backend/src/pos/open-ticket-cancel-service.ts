import type { OwnedOpenTicketCancelDependencies } from "./open-ticket-cancel-owned.js";
import { handleOwnedOpenTicketCancel } from "./open-ticket-cancel-owned.js";
import { proxyOpenTicketCancel } from "./open-ticket-cancel-proxy.js";

type OpenTicketCancelServiceOptions = {
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedOpenTicketCancelDependencies;
};

function configurationFailure(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json(
    { ok: false, reason: "OPEN_TICKET_CANCEL_BACKEND_UNAVAILABLE", requestId },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

export async function serveOpenTicketCancel(
  request: Request,
  options: OpenTicketCancelServiceOptions,
): Promise<Response> {
  const mode = options.mode ?? "owned";
  if (mode === "proxy") {
    return proxyOpenTicketCancel(request, {
      upstreamOrigin: options.upstreamOrigin,
      createRequestId: options.createRequestId,
    });
  }
  if (mode !== "owned") return configurationFailure(options.createRequestId);
  try {
    return await handleOwnedOpenTicketCancel(request, options.createOwnedDependencies());
  } catch {
    return configurationFailure(options.createRequestId);
  }
}
