import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("R5 residual read bundles retain the server/database boundary", () => {
  const migration = read("database/migrations/0010_r5_residual_read_models.sql");
  const receipts = read("src/features/receipts/detail/data.ts");
  const receiptModel = read("src/features/receipts/detail/receipt-detail-read-model.ts");
  const timeClock = read("src/features/time-clock/data.ts");
  const timeClockModel = read("src/features/time-clock/time-clock-read-model.ts");
  assert.equal((receipts.match(/\.from\s*\(/g) ?? []).length, 0);
  assert.equal((timeClock.match(/\.from\s*\(/g) ?? []).length, 0);
  assert.equal((receiptModel.match(/\.from\s*\(/g) ?? []).length, 0);
  assert.equal((timeClockModel.match(/\.from\s*\(/g) ?? []).length, 0);
  assert.equal((receiptModel.match(/\.rpc\s*\(/g) ?? []).length, 1);
  assert.equal((timeClockModel.match(/\.rpc\s*\(/g) ?? []).length, 1);
  assert.match(receipts, /hasStoreAccess\(context/);
  assert.match(receipts, /hasPermission\(context, "sales\.refund"\)/);
  assert.match(timeClock, /get_current_time_clock_entry/);
  for (const name of ["get_receipt_detail_bundle_v1", "get_time_clock_workspace_bundle_v1"]) assert.match(migration, new RegExp(`create or replace function public\\.${name}`));
  assert.equal((migration.match(/security\s+invoker/gi) ?? []).length, 2);
  assert.doesNotMatch(migration, /security\s+definer|auth\.(uid|jwt|role|user_id)\s*\(/i);
  assert.match(migration, /tindio_authenticated/);
});
