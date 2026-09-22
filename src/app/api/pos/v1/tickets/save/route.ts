import { saveOpenTicket } from "@/features/advanced-sales/ticket-service";
import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { getPosApiBusinessContext } from "@/lib/auth/pos-api-context";

export async function POST(request: Request) {
  const context = await getPosApiBusinessContext(request);
  if (!context) return posApiJson({ ok: false, message: "Sign in is required." }, 401);
  const body = await readPosApiJson(request);
  if (!body.ok) return body.response;
  return posApiJson(await saveOpenTicket({ context, input: body.input }));
}
