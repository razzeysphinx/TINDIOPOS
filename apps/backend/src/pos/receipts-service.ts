import type { OwnedReceiptsDependencies } from "./receipts-owned.js";
import { handleOwnedPosReceipts } from "./receipts-owned.js";
import { proxyPosReceipts } from "./receipts-proxy.js";

type ReceiptsServiceOptions = {
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedReceiptsDependencies;
};

function configurationFailure(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json(
    { ok: false, reason: "RECEIPTS_BACKEND_UNAVAILABLE", requestId },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

export async function servePosReceipts(
  request: Request,
  options: ReceiptsServiceOptions,
): Promise<Response> {
  const mode = options.mode ?? "owned";

  if (mode === "proxy") {
    return proxyPosReceipts(request, {
      upstreamOrigin: options.upstreamOrigin,
      createRequestId: options.createRequestId,
    });
  }
  if (mode !== "owned") return configurationFailure(options.createRequestId);

  try {
    return await handleOwnedPosReceipts(
      request,
      options.createOwnedDependencies(),
    );
  } catch {
    return configurationFailure(options.createRequestId);
  }
}
