import {
  POS_STOCK_REQUEST_RECEIPT_ID_INVALID_MESSAGE,
  posStockRequestReceiptIdSchema,
} from "@tindio/contracts/stock-request-receipt";
import { receivePosStockRequest } from "@/features/inventory/pos-transfer-service";
import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

export async function POST(request: Request, { params }: { params: Promise<{ stockRequestId: string }> }) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const context = resolved.context;
  const id = posStockRequestReceiptIdSchema.safeParse((await params).stockRequestId);
  if (!id.success) return posApiJson({ ok: false, message: POS_STOCK_REQUEST_RECEIPT_ID_INVALID_MESSAGE }, 400);
  const body = await readPosApiJson(request);
  if (!body.ok) return body.response;
  const input = { ...(body.input && typeof body.input === "object" ? body.input : {}), stockRequestId: id.data };
  return posApiJson(await receivePosStockRequest({ context, input }));
}
