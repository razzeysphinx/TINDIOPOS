import { NextResponse } from "next/server";
import { z } from "zod";

import {
  validatedSyncDevice,
} from "@/features/offline/pos-v2-sync-service";
import {
  posDeviceValidationSchema,
} from "@/features/devices/device-schema";
import {
  getPosV2BusinessContext,
} from "@/lib/auth/pos-v2-business-context";

const headers = {
  "Cache-Control": "private, no-store",
};

const connectionModeSchema = z.enum([
  "CLOUD_ONLINE",
  "STORE_LOCAL",
  "DEVICE_ISOLATED",
  "RECOVERING",
  "SYNC_REVIEW",
]);

const telemetrySchema =
  posDeviceValidationSchema.extend({
    employeeId: z.uuid(),
    employeeName:
      z.string().trim().min(1).max(160),
    connectionMode:
      connectionModeSchema,
    lastSuccessfulSyncAt:
      z.iso.datetime().nullable(),
    deviceCheckpoint:
      z.number().int().min(0),
    serverCheckpoint:
      z.number().int().min(0),
    queueDepth:
      z.number().int().min(0),
    conflictCount:
      z.number().int().min(0),
    failedCount:
      z.number().int().min(0),
    offlineSince:
      z.iso.datetime().nullable(),
  });

export async function POST(
  request: Request,
) {
  const resolved =
    await getPosV2BusinessContext(
      request,
    );

  if (!resolved.ok) {
    return resolved.response;
  }

  const parsed =
    telemetrySchema.safeParse(
      await request.json().catch(
        () => null,
      ),
    );

  if (
    // parsed.data.employeeId !== resolved.context.employee.id is enforced below.
    !parsed.success
    || parsed.data.organizationId
      !== resolved.context.organization.id
    || parsed.data.employeeId
      !== resolved.context.employee.id
  ) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "The POS telemetry request is invalid.",
      },
      {
        status: 400,
        headers,
      },
    );
  }

  try {
    const checked =
      await validatedSyncDevice(
        resolved.context,
        parsed.data,
      );

    if (!checked) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "POS device validation failed.",
        },
        {
          status: 403,
          headers,
        },
      );
    }

    const report =
      await checked.database.rpc(
        "report_pos_device_sync_telemetry",
        {
          target_organization_id:
            resolved.context.organization.id,
          target_device_id:
            checked.device.deviceId,
          target_store_id:
            checked.device.storeId,
          target_register_id:
            checked.device.registerId,
          target_employee_id:
            resolved.context.employee.id,
          target_employee_name:
            parsed.data.employeeName,
          target_connection_mode:
            parsed.data.connectionMode,
          target_app_version:
            checked.device.appVersion,
          target_last_successful_sync_at:
            parsed.data.lastSuccessfulSyncAt,
          target_device_checkpoint:
            parsed.data.deviceCheckpoint,
          target_server_checkpoint:
            parsed.data.serverCheckpoint,
          target_queue_depth:
            parsed.data.queueDepth,
          target_conflict_count:
            parsed.data.conflictCount,
          target_failed_count:
            parsed.data.failedCount,
          target_offline_since:
            parsed.data.offlineSince,
        },
      );

    if (report.error) {
      throw new Error(
        report.error.message,
      );
    }

    return NextResponse.json(
      {
        ok: true,
        deviceId:
          checked.device.deviceId,
        heartbeatAt:
          report.data?.[0]
            ?.heartbeat_at
          ?? new Date().toISOString(),
      },
      { headers },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message:
          "TINDIO could not record sync telemetry.",
      },
      {
        status: 503,
        headers,
      },
    );
  }
}
