import {
  POS_ATTENDANCE_DISABLED_MESSAGE,
  POS_ATTENDANCE_PERMISSION,
} from "@tindio/contracts/attendance-mutation";
import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { clockInEmployee } from "@/features/time-clock/service";
import { hasPermission } from "@/lib/auth/dal";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

export async function POST(request: Request) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const context = resolved.context;
  if (!context.features.time_clock || !hasPermission(context, POS_ATTENDANCE_PERMISSION)) {
    return posApiJson({ ok: false, message: POS_ATTENDANCE_DISABLED_MESSAGE });
  }
  const body = await readPosApiJson(request);
  if (!body.ok) return body.response;
  return posApiJson(await clockInEmployee({ context, input: body.input }));
}
