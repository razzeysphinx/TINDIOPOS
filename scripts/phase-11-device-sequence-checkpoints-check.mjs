import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Phase 11 device sequence checkpoints contract", () => {
  const schema = read("apps/mobile/src/db/schema.ts");
  const outbox = read("apps/mobile/src/db/outbox.ts");
  const state = read("apps/mobile/src/db/device-sync-state.ts");
  const migration = read("supabase/migrations/20260929000000_phase_11_device_sequence_checkpoints.sql");
  const route = read("src/app/api/pos/v2/offline-checkout/route.ts");
  const checkpointRoute = read("src/app/api/pos/v2/sync/checkpoint/route.ts");
  const status = read("apps/mobile/app/(app)/sync-status.tsx");
  const cache = read("apps/mobile/src/db/cache-admin.ts");

  for (const text of ["TINDIO_LOCAL_SCHEMA_VERSION = 5", "device_sequence", "device_sync_state", "idx_outbox_device_sequence"]) assert.ok(schema.includes(text));
  assert.ok(outbox.includes("withExclusiveTransactionAsync") && outbox.includes("next_sequence=next_sequence+1") && outbox.includes("deviceSequence"));
  assert.ok(state.includes("MAX(device_sequence)") && state.includes("MAX(server_checkpoint,?)"));
  for (const text of ["pos_device_sync_checkpoints", "pos_device_sequence_receipts", "reserve_pos_device_sequence", "finalize_pos_device_sequence", "get_pos_device_sync_checkpoint", "GAP", "DUPLICATE_SEQUENCE", "OUT_OF_ORDER", "REPLAY"]) assert.ok(migration.includes(text));
  assert.ok(route.indexOf("const reservation = await validateAndReserveSequence") < route.indexOf("const result = await completeCheckout"));
  assert.ok(route.includes("retryable: true") && route.includes("finalize_pos_device_sequence"));
  assert.ok(checkpointRoute.includes("validate_pos_device") && checkpointRoute.includes("get_pos_device_sync_checkpoint"));
  assert.ok(status.includes("PHASE 11 DEVICE SEQUENCE") && status.includes("Refresh Server Checkpoint"));
  assert.ok(cache.includes("device_sync_state"));
  assert.doesNotMatch(migration, /payload hash|delta[_ ]sync|pull cursor/i);
});
