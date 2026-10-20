import {
  POS_CUSTOMER_CREATION_PERMISSION,
  POS_CUSTOMER_CREATION_PERMISSION_MESSAGE,
} from "@tindio/contracts/customer-creation";
import { createCustomer } from "@/features/customers/service";
import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { hasPermission } from "@/lib/auth/dal";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

export async function POST(request: Request) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const context = resolved.context;
  if (!hasPermission(context, POS_CUSTOMER_CREATION_PERMISSION)) {
    return posApiJson({ ok: false, message: POS_CUSTOMER_CREATION_PERMISSION_MESSAGE });
  }

  const body = await readPosApiJson(request);
  if (!body.ok) return body.response;
  return posApiJson(await createCustomer({ context, input: body.input }));
}
