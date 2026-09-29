import { NextResponse } from "next/server";
import { z } from "zod";

import { posDeviceValidationSchema } from "@/features/devices/device-schema";
import { validatedSyncDevice } from "@/features/offline/pos-v2-sync-service";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

const headers = { "Cache-Control": "private, no-store" };
const connectionModeSchema = z.enum(["CLOUD_ONLINE", "STORE_LOCAL", "DEVICE_ISOLATED", "RECOVERING", "SYNC_REVIEW"]);
const localDatabaseHealthSchema = z.enum(["HEALTHY", "CHECK_REQUIRED", "UNAVAILABLE", "UNKNOWN"]);
const telemetrySchema = posDeviceValidationSchema.extend({
  employeeId: z.uuid(),
  employeeName: z.string().trim().min(1).max(160),
  connectionMode: connectionModeSchema,
  lastSuccessfulSyncAt: z.iso.datetime().nullable(),
  deviceCheckpoint: z.number().int().min(0),
  serverCheckpoint: z.number().int().min(0),
  queueDepth: z.number().int().min(0),
  conflictCount: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  offlineSince: z.iso.datetime().nullable(),
  crashCount: z.number().int().min(0).default(0),
  crashWindowStartedAt: z.iso.datetime().nullable().default(null),
  lastCrashAt: z.iso.datetime().nullable().default(null),
  apiAverageLatencyMs: z.number().int().min(0).default(0),
  apiMaxLatencyMs: z.number().int().min(0).default(0),
  apiFailureCount: z.number().int().min(0).default(0),
  syncAverageLatencyMs: z.number().int().min(0).default(0),
  syncMaxLatencyMs: z.number().int().min(0).default(0),
  localDatabaseHealth: localDatabaseHealthSchema.default("UNKNOWN"),
  localSchemaVersion: z.number().int().min(0).default(0),
});

export async function POST(request: Request) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const parsed = telemetrySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.organizationId !== resolved.context.organization.id || parsed.data.employeeId !== resolved.context.employee.id) {
    return NextResponse.json({ ok: false, message: "The POS telemetry request is invalid." }, { status: 400, headers });
  }
  try {
    const checked = await validatedSyncDevice(resolved.context, parsed.data);
    if (!checked) return NextResponse.json({ ok: false, message: "POS device validation failed." }, { status: 403, headers });
    const report = await checked.database.rpc("report_pos_device_sync_telemetry", {
      target_organization_id: resolved.context.organization.id,
      target_device_id: checked.device.deviceId,
      target_store_id: checked.device.storeId,
      target_register_id: checked.device.registerId,
      target_employee_id: resolved.context.employee.id,
      target_employee_name: parsed.data.employeeName,
      target_connection_mode: parsed.data.connectionMode,
      target_app_version: checked.device.appVersion,
      target_last_successful_sync_at: parsed.data.lastSuccessfulSyncAt,
      target_device_checkpoint: parsed.data.deviceCheckpoint,
      target_server_checkpoint: parsed.data.serverCheckpoint,
      target_queue_depth: parsed.data.queueDepth,
      target_conflict_count: parsed.data.conflictCount,
      target_failed_count: parsed.data.failedCount,
      target_offline_since: parsed.data.offlineSince,
      target_crash_count: parsed.data.crashCount,
      target_crash_window_started_at: parsed.data.crashWindowStartedAt,
      target_last_crash_at: parsed.data.lastCrashAt,
      target_api_average_latency_ms: parsed.data.apiAverageLatencyMs,
      target_api_max_latency_ms: parsed.data.apiMaxLatencyMs,
      target_api_failure_count: parsed.data.apiFailureCount,
      target_sync_average_latency_ms: parsed.data.syncAverageLatencyMs,
      target_sync_max_latency_ms: parsed.data.syncMaxLatencyMs,
      target_local_database_health: parsed.data.localDatabaseHealth,
      target_local_schema_version: parsed.data.localSchemaVersion,
    });
    if (report.error) throw new Error(report.error.message);
    return NextResponse.json({ ok: true, deviceId: checked.device.deviceId, heartbeatAt: report.data?.[0]?.heartbeat_at ?? new Date().toISOString() }, { headers });
  } catch {
    return NextResponse.json({ ok: false, message: "TINDIO could not record sync telemetry." }, { status: 503, headers });
  }
}
