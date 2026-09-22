import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { clockOutEmployee } from "@/features/time-clock/service";
import { hasPermission } from "@/lib/auth/dal";
import { getPosApiBusinessContext } from "@/lib/auth/pos-api-context";

export async function POST(request: Request) {
  const context = await getPosApiBusinessContext(request);
  if (!context) return posApiJson({ ok: false, message: "Sign in is required." }, 401);
  if (!context.features.time_clock || !hasPermission(context, "attendance.use")) {
    return posApiJson({ ok: false, message: "Time clock is disabled for this business." });
  }
  const body = await readPosApiJson(request);
  if (!body.ok) return body.response;
  return posApiJson(await clockOutEmployee({ context, input: body.input }));
}
