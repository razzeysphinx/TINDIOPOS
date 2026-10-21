import type { OwnedOpenTicketSplitDependencies } from "./open-ticket-split-owned.js";
import { handleOwnedOpenTicketSplit } from "./open-ticket-split-owned.js";
import { proxyOpenTicketSplit } from "./open-ticket-split-proxy.js";

type OpenTicketSplitServiceOptions = {
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedOpenTicketSplitDependencies;
};

function configurationFailure(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json(
    { ok: false, reason: "OPEN_TICKET_SPLIT_BACKEND_UNAVAILABLE", requestId },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

export async function serveOpenTicketSplit(
  request: Request,
  options: OpenTicketSplitServiceOptions,
): Promise<Response> {
  const mode = options.mode ?? "owned";
  if (mode === "proxy") {
    return proxyOpenTicketSplit(request, {
      upstreamOrigin: options.upstreamOrigin,
      createRequestId: options.createRequestId,
    });
  }
  if (mode !== "owned") return configurationFailure(options.createRequestId);
  try {
    return await handleOwnedOpenTicketSplit(request, options.createOwnedDependencies());
  } catch {
    return configurationFailure(options.createRequestId);
  }
}
