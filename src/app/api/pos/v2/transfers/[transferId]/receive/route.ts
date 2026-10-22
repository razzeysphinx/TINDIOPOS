import {
  POS_TRANSFER_RECEIPT_ID_INVALID_MESSAGE,
  posTransferReceiptIdSchema,
} from "@tindio/contracts/transfer-receipt";
import { receivePosStockTransfer } from "@/features/inventory/pos-transfer-service";
import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

export async function POST(request: Request, { params }: { params: Promise<{ transferId: string }> }) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const context = resolved.context;
  const id = posTransferReceiptIdSchema.safeParse((await params).transferId);
  if (!id.success) return posApiJson({ ok: false, message: POS_TRANSFER_RECEIPT_ID_INVALID_MESSAGE }, 400);
  const body = await readPosApiJson(request);
  if (!body.ok) return body.response;
  const input = { ...(body.input && typeof body.input === "object" ? body.input : {}), stockTransferId: id.data };
  return posApiJson(await receivePosStockTransfer({ context, input }));
}
