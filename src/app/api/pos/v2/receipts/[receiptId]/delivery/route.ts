import { z } from "zod";

import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { queueReceiptDelivery } from "@/features/receipts/service";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

const receiptIdSchema = z.uuid();

export async function POST(request: Request, { params }: { params: Promise<{ receiptId: string }> }) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const context = resolved.context;
  const receiptId = receiptIdSchema.safeParse((await params).receiptId);
  if (!receiptId.success) return posApiJson({ ok: false, message: "This receipt is invalid." }, 400);
  const body = await readPosApiJson(request);
  if (!body.ok) return body.response;
  const input = { ...(body.input && typeof body.input === "object" ? body.input : {}), receiptId: receiptId.data };
  return posApiJson(await queueReceiptDelivery({ context, input }));
}
