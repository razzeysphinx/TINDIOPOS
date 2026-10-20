import type { OwnedReceiptDetailDependencies } from "./receipt-detail-owned.js";
import { handleOwnedPosReceiptDetail } from "./receipt-detail-owned.js";
import { proxyPosReceiptDetail } from "./receipt-detail-proxy.js";

type ReceiptDetailServiceOptions = {
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedReceiptDetailDependencies;
};

function configurationFailure(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json(
    { ok: false, reason: "RECEIPT_DETAIL_BACKEND_UNAVAILABLE", requestId },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

export async function servePosReceiptDetail(
  request: Request,
  options: ReceiptDetailServiceOptions,
): Promise<Response> {
  const mode = options.mode ?? "owned";

  if (mode === "proxy") {
    return proxyPosReceiptDetail(request, {
      upstreamOrigin: options.upstreamOrigin,
      createRequestId: options.createRequestId,
    });
  }
  if (mode !== "owned") return configurationFailure(options.createRequestId);

  try {
    return await handleOwnedPosReceiptDetail(
      request,
      options.createOwnedDependencies(),
    );
  } catch {
    return configurationFailure(options.createRequestId);
  }
}
