import { NextResponse } from "next/server";
import {
  POS_DEVICE_ACCESS_MESSAGE,
  POS_DEVICE_ACCESS_PERMISSION,
  POS_DEVICE_INVALID_MESSAGE,
  POS_DEVICE_REJECTED_MESSAGE,
  POS_DEVICE_UNAVAILABLE_MESSAGE,
  POS_DEVICE_VALIDATION_RPC,
} from "@tindio/contracts/device";

import { posDeviceValidationSchema } from "@/features/devices/device-schema";
import { hasPermission } from "@/lib/auth/dal";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";
import { createBusinessContextClient } from "@/lib/supabase/context-client";

const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const context = resolved.context;
  if (!hasPermission(context, POS_DEVICE_ACCESS_PERMISSION)) {
    return NextResponse.json({ ok: false, message: POS_DEVICE_ACCESS_MESSAGE }, { status: 403, headers });
  }

  const input = posDeviceValidationSchema.safeParse(await request.json().catch(() => null));
  if (!input.success || input.data.organizationId !== context.organization.id) {
    return NextResponse.json({ ok: false, message: POS_DEVICE_INVALID_MESSAGE }, { status: 400, headers });
  }

  try {
    const database = await createBusinessContextClient(context) as unknown as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: Array<Record<string, unknown>> | null; error: { code?: string; message?: string } | null }>;
    };
    const { data, error } = await database.rpc(POS_DEVICE_VALIDATION_RPC, {
      target_organization_id: context.organization.id,
      target_device_id: input.data.device.deviceId,
      target_secret: input.data.device.secret,
      target_app_version: input.data.device.appVersion,
    });
    const device = data?.[0];
    if (error || !device) {
      return NextResponse.json(
        { ok: false, message: POS_DEVICE_REJECTED_MESSAGE },
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
    return NextResponse.json({ ok: false, message: POS_DEVICE_UNAVAILABLE_MESSAGE }, { status: 503, headers });
  }
}
