import { z } from "zod";

import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { queueReceiptDelivery } from "@/features/receipts/service";
import { getPosApiBusinessContext } from "@/lib/auth/pos-api-context";

const receiptIdSchema = z.uuid();

export async function POST(request: Request, { params }: { params: Promise<{ receiptId: string }> }) {
  const context = await getPosApiBusinessContext(request);
  if (!context) return posApiJson({ ok: false, message: "Sign in is required." }, 401);
  const receiptId = receiptIdSchema.safeParse((await params).receiptId);
  if (!receiptId.success) return posApiJson({ ok: false, message: "This receipt is invalid." }, 400);
  const body = await readPosApiJson(request);
  if (!body.ok) return body.response;
  const input = { ...(body.input && typeof body.input === "object" ? body.input : {}), receiptId: receiptId.data };
  return posApiJson(await queueReceiptDelivery({ context, input }));
}
