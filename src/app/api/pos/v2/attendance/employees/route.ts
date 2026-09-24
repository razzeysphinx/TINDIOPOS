import {
  posUuidSchema as storeSchema,
} from "@/contracts/pos";
import { posApiJson } from "@/features/pos/pos-api-response";
import { loadAttendanceEmployees } from "@/features/time-clock/data";
import { hasPermission } from "@/lib/auth/dal";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

export async function GET(request: Request) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const context = resolved.context;
  if (!context.features.time_clock || !hasPermission(context, "attendance.use")) {
    return posApiJson({ ok: false, message: "Attendance is unavailable for this store.", employees: [] }, 403);
  }
  const storeId = storeSchema.safeParse(new URL(request.url).searchParams.get("store"));
  if (!storeId.success || !context.storeIds.includes(storeId.data)) {
    return posApiJson({ ok: false, message: "Choose one of your assigned stores.", employees: [] }, 400);
  }
  try {
    return posApiJson({ ok: true, employees: await loadAttendanceEmployees(context, storeId.data) });
  } catch {
    return posApiJson({ ok: false, message: "TINDIO could not load employees for attendance.", employees: [] });
  }
}
