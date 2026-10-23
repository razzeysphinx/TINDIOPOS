import { POS_SALE_EXCHANGE_REQUEST_INVALID_MESSAGE } from "@tindio/contracts/sale-exchange";

import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { linkSaleExchange } from "@/features/receipts/service";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

export async function POST(request: Request) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;

  const body = await readPosApiJson(request);
  if (!body.ok) {
    return posApiJson({ ok: false, message: POS_SALE_EXCHANGE_REQUEST_INVALID_MESSAGE }, 400);
  }
  return posApiJson(await linkSaleExchange({ context: resolved.context, input: body.input }));
}
