import { NextResponse } from "next/server";

import { posDeviceValidationSchema } from "@/features/devices/device-schema";
import { getBusinessContext, hasPermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  const context = await getBusinessContext();
  if (!context) {
    return NextResponse.json({ ok: false, message: "Sign in is required to use this POS device." }, { status: 401, headers });
  }
  if (!hasPermission(context, "pos.access")) {
    return NextResponse.json({ ok: false, message: "POS access is not permitted." }, { status: 403, headers });
  }

  const input = posDeviceValidationSchema.safeParse(await request.json().catch(() => null));
  if (!input.success || input.data.organizationId !== context.organization.id) {
    return NextResponse.json({ ok: false, message: "The POS device request is invalid." }, { status: 400, headers });
  }

  try {
    const database = await createClient() as unknown as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: Array<Record<string, unknown>> | null; error: { code?: string; message?: string } | null }>;
    };
    const { data, error } = await database.rpc("validate_pos_device", {
      target_organization_id: context.organization.id,
      target_device_id: input.data.device.deviceId,
      target_secret: input.data.device.secret,
      target_app_version: input.data.device.appVersion,
    });
    const device = data?.[0];
    if (error || !device) {
      return NextResponse.json(
        { ok: false, message: "This POS device is not active for your assigned store." },
        { status: 403, headers },
      );
    }

    return NextResponse.json({
      ok: true,
      device: {
        deviceId: String(device.device_id),
        storeId: String(device.store_id),
        registerId: String(device.register_id),
        deviceName: String(device.device_name),
        appVersion: String(device.app_version),
        lastSeenAt: String(device.last_seen_at),
      },
    }, { headers });
  } catch {
    return NextResponse.json({ ok: false, message: "TINDIO could not verify this POS device." }, { status: 503, headers });
  }
}
