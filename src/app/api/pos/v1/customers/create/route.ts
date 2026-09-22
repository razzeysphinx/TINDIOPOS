import { createCustomer } from "@/features/customers/service";
import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { hasPermission } from "@/lib/auth/dal";
import { getPosApiBusinessContext } from "@/lib/auth/pos-api-context";

export async function POST(request: Request) {
  const context = await getPosApiBusinessContext(request);
  if (!context) return posApiJson({ ok: false, message: "Sign in is required." }, 401);
  if (!hasPermission(context, "customers.manage")) {
    return posApiJson({ ok: false, message: "You do not have permission to manage customers." });
  }

  const body = await readPosApiJson(request);
  if (!body.ok) return body.response;
  return posApiJson(await createCustomer({ context, input: body.input }));
}
