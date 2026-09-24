import { createCustomer } from "@/features/customers/service";
import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { hasPermission } from "@/lib/auth/dal";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

export async function POST(request: Request) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const context = resolved.context;
  if (!hasPermission(context, "customers.manage")) {
    return posApiJson({ ok: false, message: "You do not have permission to manage customers." });
  }

  const body = await readPosApiJson(request);
  if (!body.ok) return body.response;
  return posApiJson(await createCustomer({ context, input: body.input }));
}
