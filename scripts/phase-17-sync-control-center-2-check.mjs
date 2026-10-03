import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Phase 17 Sync Control Center 2.0 implementation contract", () => {
  const migration = fs.readFileSync(
    "archive/database/supabase-migrations/20260929173000_phase_17_sync_control_center_telemetry.sql",
    "utf8",
  );

  const route = fs.readFileSync(
    "src/app/api/pos/v2/sync/telemetry/route.ts",
    "utf8",
  );

  const reporter = fs.readFileSync(
    "apps/mobile/src/features/sync/sync-telemetry-reporter.tsx",
    "utf8",
  );

  const page = fs.readFileSync(
    "src/app/(back-office)/back-office/offline-sync/page.tsx",
    "utf8",
  );

  const ui = fs.readFileSync(
    "src/features/offline/sync-control-center-device-health.tsx",
    "utf8",
  );

  const outboxTypes = fs.readFileSync(
    "apps/mobile/src/features/outbox/outbox-types.ts",
    "utf8",
  );

  assert.ok(
    migration.includes(
      "private.has_permission(organization_id, 'devices.manage')",
    ),
    "Back Office telemetry must remain devices.manage guarded",
  );

  assert.ok(
    route.includes("validatedSyncDevice"),
    "telemetry writes must validate device identity",
  );

  assert.ok(
    reporter.includes("reportPosV2SyncTelemetry"),
    "native POS must report health telemetry",
  );

  assert.doesNotMatch(
    reporter,
    /payload_json|snapshot_json|payments|customerId|card/i,
    "telemetry must not contain transaction/customer/payment payloads",
  );

  for (const marker of [
    "Sync Control Center 2.0",
    "GlobalFilterBar",
    "OfflineSyncCenter",
  ]) {
    assert.ok(
      page.includes(marker),
      `Back Office page must preserve ${marker}`,
    );
  }

  for (const marker of [
    "ATTENTION REQUIRED",
    "CHECK REQUIRED",
    "HEALTHY",
    "Queue depth",
    "Checkpoint gap",
    "Offline duration",
  ]) {
    assert.ok(
      ui.includes(marker),
      `device health UI must expose ${marker}`,
    );
  }

  assert.equal(
    /export type OutboxOperationType\s*=\s*"SALE_COMPLETED"/.test(outboxTypes),
    true,
    "Phase 17 must not expand durable outbox operations",
  );

  assert.doesNotMatch(
    migration,
    /update\s+inventory|insert\s+into\s+inventory_ledger/i,
    "telemetry migration must not mutate inventory authority",
  );
});
