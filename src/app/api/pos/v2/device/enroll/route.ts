import {
  POS_DEVICE_ENROLLMENT_CONFIRMATION_MESSAGE,
  POS_DEVICE_ENROLLMENT_DUPLICATE_MESSAGE,
  POS_DEVICE_ENROLLMENT_INVALID_MESSAGE,
  POS_DEVICE_ENROLLMENT_PERMISSION_MESSAGE,
  POS_DEVICE_ENROLLMENT_RPC,
  POS_DEVICE_ENROLLMENT_SCOPE_MESSAGE,
  POS_DEVICE_ENROLLMENT_UNAVAILABLE_MESSAGE,
  POS_DEVICE_MANAGEMENT_MESSAGE,
  POS_DEVICE_MANAGEMENT_PERMISSION,
  registerPosDeviceSchema,
} from "@tindio/contracts/device";
import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { hasPermission } from "@/lib/auth/dal";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";
import { createBusinessContextClient } from "@/lib/supabase/context-client";
type RpcError = { code?: string };
const enrollmentError = (error: RpcError | null) => posApiJson({ ok: false, message: error?.code === "42501" ? POS_DEVICE_ENROLLMENT_PERMISSION_MESSAGE : error?.code === "23514" ? POS_DEVICE_ENROLLMENT_SCOPE_MESSAGE : error?.code === "23505" ? POS_DEVICE_ENROLLMENT_DUPLICATE_MESSAGE : POS_DEVICE_ENROLLMENT_UNAVAILABLE_MESSAGE }, error?.code === "42501" ? 403 : error?.code === "23514" ? 400 : error?.code === "23505" ? 409 : 503);
export async function POST(request: Request) { const resolved = await getPosV2BusinessContext(request); if (!resolved.ok) return resolved.response; const context = resolved.context; if (!hasPermission(context, POS_DEVICE_MANAGEMENT_PERMISSION)) return posApiJson({ ok: false, message: POS_DEVICE_MANAGEMENT_MESSAGE }, 403); const body = await readPosApiJson(request); if (!body.ok) return body.response; const parsed = registerPosDeviceSchema.safeParse(body.input); if (!parsed.success) return posApiJson({ ok: false, message: POS_DEVICE_ENROLLMENT_INVALID_MESSAGE }, 400); try { const database = await createBusinessContextClient(context) as unknown as { rpc(name: string, args: Record<string, unknown>): Promise<{ data: Array<Record<string, unknown>> | null; error: RpcError | null }> }; const { data, error } = await database.rpc(POS_DEVICE_ENROLLMENT_RPC, { target_organization_id: context.organization.id, target_store_id: parsed.data.storeId, target_register_id: parsed.data.registerId, target_device_id: parsed.data.deviceId, target_name: parsed.data.name, target_app_version: parsed.data.appVersion, target_secret: parsed.data.secret }); if (error) return enrollmentError(error); const row = data?.[0]; const lastSeenAt = typeof row?.last_seen_at === "string" ? row.last_seen_at : null; if (!row || !lastSeenAt) return posApiJson({ ok: false, message: POS_DEVICE_ENROLLMENT_CONFIRMATION_MESSAGE }, 503); return posApiJson({ ok: true, device: { deviceId: parsed.data.deviceId, storeId: parsed.data.storeId, registerId: parsed.data.registerId, deviceName: parsed.data.name, appVersion: parsed.data.appVersion, lastSeenAt } }); } catch { return posApiJson({ ok: false, message: POS_DEVICE_ENROLLMENT_UNAVAILABLE_MESSAGE }, 503); } }
