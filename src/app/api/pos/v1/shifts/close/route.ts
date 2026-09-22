import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { closeShift } from "@/features/shifts/service";
import { getPosApiBusinessContext } from "@/lib/auth/pos-api-context";

export async function POST(request: Request) {
  const context = await getPosApiBusinessContext(request);
  if (!context) return posApiJson({ ok: false, message: "Sign in is required." }, 401);
  const body = await readPosApiJson(request);
  if (!body.ok) return body.response;
  return posApiJson(await closeShift({ context, input: body.input }));
}
