import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Phase 17 Slice 03 Sync Control Center UI", () => {
  const page = fs.readFileSync(
    "src/app/(back-office)/back-office/offline-sync/page.tsx",
    "utf8",
  );

  const ui = fs.readFileSync(
    "src/features/offline/sync-control-center-device-health.tsx",
    "utf8",
  );

  for (const marker of [
    "Sync Control Center 2.0",
    "pos_device_sync_telemetry",
    "devices.manage",
    "OfflineSyncCenter",
  ]) {
    assert.ok(
      page.includes(marker),
      `page must include ${marker}`,
    );
  }

  for (const marker of [
    "CLOUD_ONLINE",
    "STORE_LOCAL",
    "DEVICE_ISOLATED",
    "RECOVERING",
    "SYNC_REVIEW",
    "Last successful sync",
    "Offline duration",
    "Device checkpoint",
    "Server checkpoint",
    "Queue depth",
    "Conflicts",
  ]) {
    assert.ok(
      ui.includes(marker),
      `UI must include ${marker}`,
    );
  }

  assert.ok(
    ui.includes("ATTENTION REQUIRED")
    && ui.includes("CHECK REQUIRED"),
    "sync problems must be visibly classified",
  );
});
