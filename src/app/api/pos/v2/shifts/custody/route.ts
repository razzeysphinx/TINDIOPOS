import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { acquireMobileShiftCustody } from "@/features/shifts/service";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

export async function POST(request: Request) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const body = await readPosApiJson(request);
  if (!body.ok) return body.response;
  return posApiJson(await acquireMobileShiftCustody({
    context: resolved.context,
    input: body.input,
  }));
}
