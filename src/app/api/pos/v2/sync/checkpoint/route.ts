import { NextResponse } from "next/server";
import { posDeviceValidationSchema } from "@/features/devices/device-schema";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";
import { createBusinessContextClient } from "@/lib/supabase/context-client";

const headers = { "Cache-Control": "private, no-store" };
type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: Array<Record<string, unknown>> | null; error: { message?: string } | null }> };

export async function POST(request: Request) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const input = posDeviceValidationSchema.safeParse(await request.json().catch(() => null));
  if (!input.success || input.data.organizationId !== resolved.context.organization.id) return NextResponse.json({ ok: false, message: "The checkpoint request is invalid." }, { status: 400, headers });
  try {
    const database = await createBusinessContextClient(resolved.context) as unknown as RpcClient;
    const validation = await database.rpc("validate_pos_device", {
      target_organization_id: resolved.context.organization.id, target_device_id: input.data.device.deviceId,
      target_secret: input.data.device.secret, target_app_version: input.data.device.appVersion,
    });
    if (validation.error || !validation.data?.[0]) return NextResponse.json({ ok: false, message: "This POS device is not active for your assigned store." }, { status: 403, headers });
    const checkpoint = await database.rpc("get_pos_device_sync_checkpoint", {
      target_organization_id: resolved.context.organization.id, target_device_id: input.data.device.deviceId,
    });
    const value = checkpoint.data?.[0];
    if (checkpoint.error || !value) throw new Error("Checkpoint unavailable");
    return NextResponse.json({ ok: true, checkpoint: {
      deviceId: String(value.device_id), serverCheckpoint: Number(value.server_checkpoint),
      nextExpectedSequence: Number(value.next_expected_sequence), updatedAt: value.updated_at ? String(value.updated_at) : null,
    } }, { headers });
  } catch {
    return NextResponse.json({ ok: false, message: "TINDIO could not read the device checkpoint." }, { status: 503, headers });
  }
}
