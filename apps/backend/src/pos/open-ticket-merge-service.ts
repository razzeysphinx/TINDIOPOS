import type { OwnedOpenTicketMergeDependencies } from "./open-ticket-merge-owned.js";
import { handleOwnedOpenTicketMerge } from "./open-ticket-merge-owned.js";
import { proxyOpenTicketMerge } from "./open-ticket-merge-proxy.js";

type OpenTicketMergeServiceOptions = {
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedOpenTicketMergeDependencies;
};

function configurationFailure(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json(
    { ok: false, reason: "OPEN_TICKET_MERGE_BACKEND_UNAVAILABLE", requestId },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

export async function serveOpenTicketMerge(
  request: Request,
  options: OpenTicketMergeServiceOptions,
): Promise<Response> {
  const mode = options.mode ?? "owned";
  if (mode === "proxy") {
    return proxyOpenTicketMerge(request, {
      upstreamOrigin: options.upstreamOrigin,
      createRequestId: options.createRequestId,
    });
  }
  if (mode !== "owned") return configurationFailure(options.createRequestId);
  try {
    return await handleOwnedOpenTicketMerge(request, options.createOwnedDependencies());
  } catch {
    return configurationFailure(options.createRequestId);
  }
}
