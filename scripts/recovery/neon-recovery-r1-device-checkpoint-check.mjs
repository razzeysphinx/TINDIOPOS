import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260930113000_recovery_r1_device_checkpoint_ambiguity_repair.sql",
  "utf8",
);

test("device checkpoint repair preserves the public RPC contract", () => {
  assert.match(migration, /create or replace function public\.get_pos_device_sync_checkpoint\s*\(\s*target_organization_id uuid,\s*target_device_id uuid\s*\)/i);
  assert.match(migration, /returns table\s*\(\s*device_id uuid,\s*server_checkpoint bigint,\s*next_expected_sequence bigint,\s*updated_at timestamptz\s*\)/i);
});

test("device checkpoint repair removes ON CONFLICT name ambiguity", () => {
  assert.match(migration, /on conflict on constraint\s+pos_device_sync_checkpoints_pkey/i);
  assert.doesNotMatch(migration, /on conflict\s*\(\s*organization_id\s*,\s*device_id\s*\)/i);
});

test("device checkpoint repair preserves authorization and authenticated-only execution", () => {
  assert.match(migration, /private\.require_pos_sequence_access/);
  assert.match(migration, /grant execute[\s\S]*to authenticated/i);
  assert.match(migration, /revoke execute[\s\S]*from[\s\S]*public[\s\S]*anon[\s\S]*service_role/i);
});

test("device checkpoint repair contains no business-row destructive mutation", () => {
  assert.doesNotMatch(migration, /\b(?:delete\s+from|truncate|drop\s+table|drop\s+schema)\b/i);
});
