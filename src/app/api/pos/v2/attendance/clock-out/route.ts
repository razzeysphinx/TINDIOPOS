import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { clockOutEmployee } from "@/features/time-clock/service";
import { hasPermission } from "@/lib/auth/dal";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

export async function POST(request: Request) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const context = resolved.context;
  if (!context.features.time_clock || !hasPermission(context, "attendance.use")) {
    return posApiJson({ ok: false, message: "Time clock is disabled for this business." });
  }
  const body = await readPosApiJson(request);
  if (!body.ok) return body.response;
  return posApiJson(await clockOutEmployee({ context, input: body.input }));
}
