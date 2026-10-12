import { NextResponse } from "next/server";
import type { PosReferenceV2Response, PosSyncResnapshotResponse } from "@/contracts/pos";
import { syncDeviceBodySchema, validatedSyncDevice } from "@/features/offline/pos-v2-sync-service";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

const headers = { "Cache-Control": "private, no-store" };
type RpcSnapshot = Omit<PosSyncResnapshotResponse, "ok" | "version" | "clearObservedCustomers" | "invalidateModifiers">;
function jsonRpcValue<T>(data: unknown): T | undefined { return (Array.isArray(data) ? data[0] : data) as T | undefined; }

export async function POST(request: Request) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const parsed = syncDeviceBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Invalid sync resnapshot request." }, { status: 400, headers });

  try {
    const checked = await validatedSyncDevice(resolved.context, parsed.data);
    if (!checked) return NextResponse.json({ ok: false, message: "POS device validation failed." }, { status: 403, headers });
    const answer = await checked.database.rpc("get_pos_sync_resnapshot_v1", {
      target_organization_id: resolved.context.organization.id,
      target_device_id: checked.device.deviceId,
    });
    const snapshot = jsonRpcValue<RpcSnapshot>(answer.data);
    if (answer.error || !snapshot) throw new Error(`sync resnapshot unavailable: ${answer.error?.message ?? "invalid payload"}`);
    if (snapshot.organizationId !== resolved.context.organization.id || snapshot.deviceId !== checked.device.deviceId || snapshot.storeId !== checked.device.storeId) throw new Error("sync resnapshot scope mismatch");
    if (!Number.isSafeInteger(Number(snapshot.serverRevision)) || !Number.isSafeInteger(Number(snapshot.retainedAfterRevision)) || Number(snapshot.serverRevision) < Number(snapshot.retainedAfterRevision)) throw new Error("invalid sync resnapshot revision");
    if (!Array.isArray(snapshot.catalog) || !snapshot.reference || snapshot.reference.organizationId !== resolved.context.organization.id) throw new Error("invalid sync resnapshot payload");
    const body: PosSyncResnapshotResponse = {
      ...snapshot,
      ok: true,
      version: 1,
      serverRevision: Number(snapshot.serverRevision),
      retainedAfterRevision: Number(snapshot.retainedAfterRevision),
      reference: snapshot.reference as PosReferenceV2Response,
      clearObservedCustomers: true,
      invalidateModifiers: true,
    };
    return NextResponse.json(body, { headers });
  } catch (error) {
    console.error("POS sync resnapshot failed", { message: error instanceof Error ? error.message : "unknown error" });
    return NextResponse.json({ ok: false, message: "TINDIO could not rebuild the local cache." }, { status: 503, headers });
  }
}
