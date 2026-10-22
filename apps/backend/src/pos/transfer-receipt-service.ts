import type { OwnedTransferReceiptDependencies } from "./transfer-receipt-owned.js";
import { handleOwnedTransferReceipt } from "./transfer-receipt-owned.js";
import { proxyTransferReceipt } from "./transfer-receipt-proxy.js";

type TransferReceiptServiceOptions = {
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedTransferReceiptDependencies;
};

function configurationFailure(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json(
    { ok: false, reason: "TRANSFER_RECEIPT_BACKEND_UNAVAILABLE", requestId },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

export async function serveTransferReceipt(
  request: Request,
  options: TransferReceiptServiceOptions,
): Promise<Response> {
  const mode = options.mode ?? "owned";
  if (mode === "proxy") {
    return proxyTransferReceipt(request, {
      upstreamOrigin: options.upstreamOrigin,
      createRequestId: options.createRequestId,
    });
  }
  if (mode !== "owned") return configurationFailure(options.createRequestId);
  try {
    return await handleOwnedTransferReceipt(request, options.createOwnedDependencies());
  } catch {
    return configurationFailure(options.createRequestId);
  }
}
