import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Phase 16 Slice 03 isolated diagnostics", () => {
  const diagnostics = fs.readFileSync(
    "apps/mobile/src/features/offline/isolated-runtime-diagnostics.ts",
    "utf8",
  );

  const home = fs.readFileSync(
    "apps/mobile/app/(app)/index.tsx",
    "utf8",
  );

  const status = fs.readFileSync(
    "apps/mobile/app/(app)/sync-status.tsx",
    "utf8",
  );

  for (const marker of [
    "unresolvedTransactions",
    "nextDeviceSequence",
    "serverCheckpoint",
    "pullCursor",
    "offlineAuthorization",
    "recoverySafeForCloudOnline",
  ]) {
    assert.ok(
      diagnostics.includes(marker),
      `diagnostics must include ${marker}`,
    );
  }

  assert.ok(
    home.includes("RECOVERING — CLOUD RETURNED")
    && home.includes("SYNC REVIEW REQUIRED"),
    "home must distinguish recovery/review from isolated mode",
  );

  assert.ok(
    status.includes("PHASE 16 ISOLATED DEVICE MODE")
    && status.includes("Recovery safe for CLOUD_ONLINE:"),
    "Sync Status must surface isolated recovery diagnostics",
  );
});
