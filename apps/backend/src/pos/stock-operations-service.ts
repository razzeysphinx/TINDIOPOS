import { handleOwnedStockOperation, type OwnedStockOperationsDependencies, type StockOperationAction } from "./stock-operations-owned.js";
import { proxyStockOperation } from "./stock-operations-proxy.js";

type Options = {
  action: StockOperationAction;
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedStockOperationsDependencies;
};
function unavailable(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json({ ok: false, reason: "STOCK_OPERATIONS_BACKEND_UNAVAILABLE", requestId }, { status: 503, headers: { "cache-control": "private, no-store" } });
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

export async function serveStockOperation(request: Request, options: Options): Promise<Response> {
  const mode = options.mode ?? "owned";
  if (mode === "proxy") return proxyStockOperation(request, { upstreamOrigin: options.upstreamOrigin, createRequestId: options.createRequestId });
  if (mode !== "owned") return unavailable(options.createRequestId);
  try { return await handleOwnedStockOperation(request, options.action, options.createOwnedDependencies()); }
  catch { return unavailable(options.createRequestId); }
}
