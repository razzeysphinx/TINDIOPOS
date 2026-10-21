import type { OwnedOpenTicketSaveDependencies } from "./open-ticket-save-owned.js";
import { handleOwnedOpenTicketSave } from "./open-ticket-save-owned.js";
import { proxyOpenTicketSave } from "./open-ticket-save-proxy.js";

type OpenTicketSaveServiceOptions = {
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedOpenTicketSaveDependencies;
};

function configurationFailure(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json(
    { ok: false, reason: "OPEN_TICKET_SAVE_BACKEND_UNAVAILABLE", requestId },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

export async function serveOpenTicketSave(
  request: Request,
  options: OpenTicketSaveServiceOptions,
): Promise<Response> {
  const mode = options.mode ?? "owned";
  if (mode === "proxy") {
    return proxyOpenTicketSave(request, {
      upstreamOrigin: options.upstreamOrigin,
      createRequestId: options.createRequestId,
    });
  }
  if (mode !== "owned") return configurationFailure(options.createRequestId);
  try {
    return await handleOwnedOpenTicketSave(request, options.createOwnedDependencies());
  } catch {
    return configurationFailure(options.createRequestId);
  }
}
