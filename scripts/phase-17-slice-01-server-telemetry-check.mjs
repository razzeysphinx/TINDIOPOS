import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Phase 17 Slice 01 server telemetry", () => {
  const migration = fs.readFileSync(
    "supabase/migrations/20260929173000_phase_17_sync_control_center_telemetry.sql",
    "utf8",
  );

  const route = fs.readFileSync(
    "src/app/api/pos/v2/sync/telemetry/route.ts",
    "utf8",
  );

  for (const marker of [
    "pos_device_sync_telemetry",
    "connection_mode",
    "last_heartbeat_at",
    "last_successful_sync_at",
    "device_checkpoint",
    "server_checkpoint",
    "queue_depth",
    "conflict_count",
    "offline_since",
  ]) {
    assert.ok(
      migration.includes(marker),
      `migration must include ${marker}`,
    );
  }

  assert.ok(
    migration.includes(
      "private.has_permission(organization_id, 'devices.manage')",
    ),
    "Back Office telemetry reads must be permission guarded",
  );

  assert.ok(
    route.includes("validatedSyncDevice"),
    "telemetry must validate the enrolled device",
  );

  assert.ok(
    route.includes(
      "parsed.data.employeeId !== resolved.context.employee.id",
    ),
    "telemetry must bind employee identity to authenticated business context",
  );
});
