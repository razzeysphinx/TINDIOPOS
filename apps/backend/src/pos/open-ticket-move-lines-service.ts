import type { OwnedOpenTicketMoveLinesDependencies } from "./open-ticket-move-lines-owned.js";
import { handleOwnedOpenTicketMoveLines } from "./open-ticket-move-lines-owned.js";
import { proxyOpenTicketMoveLines } from "./open-ticket-move-lines-proxy.js";

type OpenTicketMoveLinesServiceOptions = {
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedOpenTicketMoveLinesDependencies;
};

function configurationFailure(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json(
    { ok: false, reason: "OPEN_TICKET_MOVE_LINES_BACKEND_UNAVAILABLE", requestId },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

export async function serveOpenTicketMoveLines(
  request: Request,
  options: OpenTicketMoveLinesServiceOptions,
): Promise<Response> {
  const mode = options.mode ?? "owned";
  if (mode === "proxy") {
    return proxyOpenTicketMoveLines(request, {
      upstreamOrigin: options.upstreamOrigin,
      createRequestId: options.createRequestId,
    });
  }
  if (mode !== "owned") return configurationFailure(options.createRequestId);
  try {
    return await handleOwnedOpenTicketMoveLines(request, options.createOwnedDependencies());
  } catch {
    return configurationFailure(options.createRequestId);
  }
}
