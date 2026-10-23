import { NextResponse } from "next/server";
import {
  POS_SYNC_DEVICE_REJECTED_MESSAGE,
  POS_SYNC_TELEMETRY_INVALID_MESSAGE,
  POS_SYNC_TELEMETRY_RPC,
  POS_SYNC_TELEMETRY_UNAVAILABLE_MESSAGE,
  posSyncTelemetryRequestSchema,
} from "@tindio/contracts/sync-control";
import { validatedSyncDevice } from "@/features/offline/pos-v2-sync-service";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const parsed = posSyncTelemetryRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.organizationId !== resolved.context.organization.id || parsed.data.employeeId !== resolved.context.employee.id) {
    return NextResponse.json({ ok: false, message: POS_SYNC_TELEMETRY_INVALID_MESSAGE }, { status: 400, headers });
  }
  try {
    const checked = await validatedSyncDevice(resolved.context, parsed.data);
    if (!checked) return NextResponse.json({ ok: false, message: POS_SYNC_DEVICE_REJECTED_MESSAGE }, { status: 403, headers });
    const report = await checked.database.rpc(POS_SYNC_TELEMETRY_RPC, {
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
      target_anr_count: parsed.data.anrCount,
      target_last_anr_at: parsed.data.lastAnrAt,
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
    return NextResponse.json({ ok: false, message: POS_SYNC_TELEMETRY_UNAVAILABLE_MESSAGE }, { status: 503, headers });
  }
}
