import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Phase 17 Slice 02 native telemetry", () => {
  const reporter = fs.readFileSync(
    "apps/mobile/src/features/sync/sync-telemetry-reporter.tsx",
    "utf8",
  );

  const state = fs.readFileSync(
    "apps/mobile/src/features/offline/connection-mode-state.ts",
    "utf8",
  );

  const layout = fs.readFileSync(
    "apps/mobile/app/(app)/_layout.tsx",
    "utf8",
  );

  const api = fs.readFileSync(
    "apps/mobile/src/lib/tindio-api.ts",
    "utf8",
  );

  for (const marker of [
    "queueDepth",
    "conflictCount",
    "serverCheckpoint",
    "deviceCheckpoint",
    "lastSuccessfulSyncAt",
    "offlineSince",
  ]) {
    assert.ok(
      reporter.includes(marker),
      `reporter must include ${marker}`,
    );
  }

  assert.ok(
    state.includes("offlineSince"),
    "connection mode state must preserve offline duration origin",
  );

  assert.ok(
    layout.includes("SyncTelemetryReporter"),
    "telemetry reporter must mount in the authenticated app shell",
  );

  assert.ok(
    api.includes("/api/pos/v2/sync/telemetry"),
    "mobile API client must expose the telemetry endpoint",
  );

  assert.doesNotMatch(
    reporter,
    /customer|payment|card/i,
    "telemetry reporter must not send customer/payment/card content",
  );
});
