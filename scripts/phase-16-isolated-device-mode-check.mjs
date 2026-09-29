import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Phase 16 isolated device mode implementation contract", () => {
  const provider = fs.readFileSync(
    "apps/mobile/src/features/business/business-context-provider.tsx",
    "utf8",
  );

  const recovery = fs.readFileSync(
    "apps/mobile/src/features/offline/recover-cloud-connection.ts",
    "utf8",
  );

  const custody = fs.readFileSync(
    "apps/mobile/src/features/offline/transaction-custody.ts",
    "utf8",
  );

  const diagnostics = fs.readFileSync(
    "apps/mobile/src/features/offline/isolated-runtime-diagnostics.ts",
    "utf8",
  );

  const outboxTypes = fs.readFileSync(
    "apps/mobile/src/features/outbox/outbox-types.ts",
    "utf8",
  );

  const outboxDb = fs.readFileSync(
    "apps/mobile/src/db/outbox.ts",
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
    provider.includes("recoverCloudConnection"),
    "cloud return must use the deterministic recovery orchestrator",
  );

  assert.ok(
    recovery.includes("reconcileCloud")
    && recovery.includes("SERVER_DELTA_CHANGES_REMAIN")
    && recovery.includes("OUTBOX_NOT_DRAINED")
    && recovery.includes("OUTBOX_REVIEW_REQUIRED"),
    "recovery must check reconciliation, delta completion, queue drain, and review state",
  );

  assert.ok(
    custody.includes("state<>'SYNCED'"),
    "destructive custody release must be blocked by unresolved transactions",
  );

  assert.ok(
    diagnostics.includes("recoverySafeForCloudOnline"),
    "local diagnostics must expose cloud-online recovery safety",
  );

  assert.equal(
    /export type OutboxOperationType\s*=\s*"SALE_COMPLETED"/.test(outboxTypes),
    true,
    "Phase 16 must not silently expand the durable outbox operation set",
  );

  assert.ok(
    outboxDb.includes("idempotency_key")
    && outboxDb.includes("device_sequence"),
    "durable events must preserve stable idempotency and device sequence",
  );

  assert.doesNotMatch(
    recovery,
    /DELETE\s+FROM\s+outbox_events/i,
    "recovery must never delete unresolved outbox data",
  );
});
