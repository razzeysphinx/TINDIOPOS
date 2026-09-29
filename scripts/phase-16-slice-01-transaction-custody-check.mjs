import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Phase 16 Slice 01 transaction custody", () => {
  const custody = fs.readFileSync(
    "apps/mobile/src/features/offline/transaction-custody.ts",
    "utf8",
  );

  const session = fs.readFileSync(
    "apps/mobile/src/features/session/session-provider.tsx",
    "utf8",
  );

  const home = fs.readFileSync(
    "apps/mobile/app/(app)/index.tsx",
    "utf8",
  );

  const settings = fs.readFileSync(
    "apps/mobile/app/(app)/settings.tsx",
    "utf8",
  );

  assert.ok(
    custody.includes("state<>'SYNCED'"),
    "custody must count all unresolved durable events",
  );

  assert.ok(
    session.includes("canReleaseTransactionCustody"),
    "sign out must be custody guarded",
  );

  assert.ok(
    home.includes("switchOrganization")
    && home.includes("canReleaseTransactionCustody"),
    "organization switching must be custody guarded",
  );

  assert.ok(
    settings.includes("Store Hub configuration is being retained as a recovery path."),
    "Store Hub removal must be blocked while unresolved transactions exist",
  );
});
