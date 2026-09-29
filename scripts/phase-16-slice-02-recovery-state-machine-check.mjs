import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Phase 16 Slice 02 recovery state machine", () => {
  const provider = fs.readFileSync(
    "apps/mobile/src/features/business/business-context-provider.tsx",
    "utf8",
  );

  const recovery = fs.readFileSync(
    "apps/mobile/src/features/offline/recover-cloud-connection.ts",
    "utf8",
  );

  const state = fs.readFileSync(
    "apps/mobile/src/features/offline/connection-mode-state.ts",
    "utf8",
  );

  for (const mode of [
    "DEVICE_ISOLATED",
    "STORE_LOCAL",
    "RECOVERING",
    "SYNC_REVIEW",
    "CLOUD_ONLINE",
  ]) {
    assert.ok(
      provider.includes(mode),
      `provider must include ${mode}`,
    );
  }

  assert.ok(
    provider.includes('setMode("offline")')
    && provider.includes('"RECOVERING"'),
    "cloud connectivity must not immediately enable online mutation mode during recovery",
  );

  assert.ok(
    recovery.includes("reconcileCloud")
    && recovery.includes("getOutboxSummary"),
    "recovery must reconcile cloud and verify durable queue state",
  );

  assert.ok(
    recovery.includes("OUTBOX_REVIEW_REQUIRED")
    && recovery.includes("SERVER_DELTA_CHANGES_REMAIN")
    && recovery.includes("OUTBOX_NOT_DRAINED"),
    "recovery must refuse premature CLOUD_ONLINE state",
  );

  assert.ok(
    state.includes("writeLocalMetadata")
    && state.includes("readLocalMetadata"),
    "connection mode must survive process restarts",
  );
});
