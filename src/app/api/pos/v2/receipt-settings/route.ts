import { POS_RECEIPT_SETTINGS_REQUEST_INVALID_MESSAGE } from "@tindio/contracts/receipt-settings";

import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { updateReceiptSettings } from "@/features/receipts/service";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

export async function POST(request: Request) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const body = await readPosApiJson(request);
  if (!body.ok) {
    return posApiJson({ ok: false, message: POS_RECEIPT_SETTINGS_REQUEST_INVALID_MESSAGE }, 400);
  }
  return posApiJson(await updateReceiptSettings({ context: resolved.context, input: body.input }));
}
