import type { OwnedReceiptAdministrationDependencies } from "./receipt-administration-owned.js";
import {
  handleOwnedReceiptDelivery,
  handleOwnedReceiptSettings,
} from "./receipt-administration-owned.js";
import { proxyReceiptAdministration } from "./receipt-administration-proxy.js";

type ReceiptAdministrationAction = "settings" | "delivery";
type ReceiptAdministrationServiceOptions = {
  action: ReceiptAdministrationAction;
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedReceiptAdministrationDependencies;
};

function configurationFailure(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json(
    { ok: false, reason: "RECEIPT_ADMINISTRATION_BACKEND_UNAVAILABLE", requestId },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

export async function serveReceiptAdministration(
  request: Request,
  options: ReceiptAdministrationServiceOptions,
): Promise<Response> {
  const mode = options.mode ?? "owned";
  if (mode === "proxy") {
    return proxyReceiptAdministration(request, {
      upstreamOrigin: options.upstreamOrigin,
      createRequestId: options.createRequestId,
    });
  }
  if (mode !== "owned") return configurationFailure(options.createRequestId);
  try {
    const dependencies = options.createOwnedDependencies();
    return options.action === "settings"
      ? await handleOwnedReceiptSettings(request, dependencies)
      : await handleOwnedReceiptDelivery(request, dependencies);
  } catch {
    return configurationFailure(options.createRequestId);
  }
}
