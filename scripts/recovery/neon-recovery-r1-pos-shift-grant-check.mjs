import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "archive/database/supabase-migrations/20260930111500_recovery_r1_pos_shift_rls_execute_grant.sql",
  "utf8",
);

test("R1 POS shift predicate grant is narrow", () => {
  assert.match(migration, /grant execute[\s\S]*private\.has_active_pos_shift_access[\s\S]*to authenticated/i);
  assert.match(migration, /revoke execute[\s\S]*from[\s\S]*public[\s\S]*anon[\s\S]*service_role/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to\s+(?:public|anon|service_role)/i);
});

test("R1 grant repair proves the RLS dependency exists", () => {
  assert.match(migration, /open_tickets_select_active_shift_owner/);
  assert.match(migration, /pg_catalog\.pg_policies/);
});

test("R1 grant repair contains no business-row mutation", () => {
  assert.doesNotMatch(migration, /\b(?:insert\s+into|update\s+public\.|delete\s+from|truncate)\b/i);
});
