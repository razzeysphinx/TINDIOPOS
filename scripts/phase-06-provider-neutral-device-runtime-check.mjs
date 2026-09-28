import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const migration = fs.readFileSync("supabase/migrations/20260928220000_phase_06_provider_neutral_device_runtime.sql", "utf8");
test("Phase 06 device runtime is provider-neutral", () => { for (const value of [/private\.current_employee_id/, /private\.has_permission/, /create or replace function private\.require_device_manager/, /create or replace function public\.validate_pos_device/, /create or replace function private\.require_active_pos_shift/]) assert.match(migration, value); assert.doesNotMatch(migration, /auth\.uid\(\)/); });
