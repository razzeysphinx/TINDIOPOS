import { randomUUID } from "node:crypto";
import { createOwnedStockOperationsDependencies } from "../../../../src/pos/stock-operations-runtime.js";
import { serveStockOperation } from "../../../../src/pos/stock-operations-service.js";

export async function POST(request: Request): Promise<Response> {
  return serveStockOperation(request, {
    action: "validate-cart", mode: process.env.TINDIO_STOCK_OPERATIONS_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN, createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedStockOperationsDependencies({ environment: process.env }),
  });
}
