import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync("database/migrations/0017_mobile_sequence_conflict_replay.sql", "utf8");

test("successful same-identity replay promotes CONFLICT to APPLIED", () => {
  assert.match(migration, /receipt\.state\s*=\s*'CONFLICT'\s+and\s+normalized_state\s*=\s*'APPLIED'/i);
  assert.match(migration, /receipt\.idempotency_key\s+is\s+null\s+or\s+receipt\.idempotency_key\s*<>\s*target_idempotency_key/i);
});

test("APPLIED is terminal and cannot regress to CONFLICT", () => {
  assert.doesNotMatch(migration, /receipt\.state\s*=\s*'APPLIED'\s+and\s+normalized_state\s*=\s*'CONFLICT'/i);
  assert.match(migration, /receipt\.state\s*=\s*'RECEIVED'/i);
});

test("installed stale-state repair requires both financial completion and synced delivery", () => {
  assert.match(migration, /checkout\.state\s*=\s*'completed'/i);
  assert.match(migration, /checkout\.sale_id\s+is\s+not\s+null/i);
  assert.match(migration, /advanced_checkout\.state\s*=\s*'completed'/i);
  assert.match(migration, /advanced_checkout\.sale_id\s+is\s+not\s+null/i);
  assert.match(migration, /sync_event\.state\s*=\s*'SYNCED'/i);
  assert.match(migration, /receipt\.idempotency_key\s*=\s*sync_event\.idempotency_key/i);
  assert.match(migration, /receipt\.local_receipt_reference\s*=\s*sync_event\.local_receipt_reference/i);
});

test("migration preserves provider-neutral least privilege", () => {
  assert.match(migration, /revoke execute[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute[\s\S]*to tindio_authenticated/i);
  assert.doesNotMatch(migration, /delete\s+from|truncate|drop\s+table/i);
});
