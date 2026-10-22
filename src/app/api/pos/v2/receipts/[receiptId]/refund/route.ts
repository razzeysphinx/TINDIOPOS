import { z } from "zod";
import {
  POS_REFUND_RECEIPT_INVALID_MESSAGE,
  POS_REFUND_RECEIPT_UNAVAILABLE_MESSAGE,
} from "@tindio/contracts/refund";

import { loadPosReceiptDetail } from "@/features/pos/data";
import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { refundSale } from "@/features/receipts/service";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

const receiptIdSchema = z.uuid();

export async function POST(request: Request, { params }: { params: Promise<{ receiptId: string }> }) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const context = resolved.context;
  const receiptId = receiptIdSchema.safeParse((await params).receiptId);
  if (!receiptId.success) return posApiJson({ ok: false, message: POS_REFUND_RECEIPT_INVALID_MESSAGE }, 400);
  const body = await readPosApiJson(request);
  if (!body.ok) return body.response;
  const detail = await loadPosReceiptDetail(context, receiptId.data);
  if (!detail) return posApiJson({ ok: false, message: POS_REFUND_RECEIPT_UNAVAILABLE_MESSAGE }, 404);
  const input = { ...(body.input && typeof body.input === "object" ? body.input : {}), saleId: detail.sale.id };
  return posApiJson(await refundSale({ context, input }));
}
