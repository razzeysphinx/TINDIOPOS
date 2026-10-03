import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) =>
  fs.readFileSync(path, "utf8");

test(
  "Phase 18 production disaster-recovery contracts remain intact",
  () => {
    const schema = read(
      "apps/mobile/src/db/schema.ts",
    );

    const database = read(
      "apps/mobile/src/db/database.ts",
    );

    const outbox = read(
      "apps/mobile/src/db/outbox.ts",
    );

    const outboxSync = read(
      "apps/mobile/src/features/outbox/outbox-sync.ts",
    );

    const cacheAdmin = read(
      "apps/mobile/src/db/cache-admin.ts",
    );

    const readiness = read(
      "apps/mobile/src/features/offline/offline-readiness.ts",
    );

    const custody = read(
      "apps/mobile/src/features/offline/transaction-custody.ts",
    );

    const checkout = read(
      "src/features/checkout/checkout-service.ts",
    );

    const offlineCheckout = read(
      "src/features/offline/pos-v2-offline-checkout-service.ts",
    );

    const sequenceMigration = read(
      "archive/database/supabase-migrations/20260929000000_phase_11_device_sequence_checkpoints.sql",
    );

    assert.ok(
      database.includes(
        "PRAGMA journal_mode = WAL",
      ),
      "SQLite must retain WAL durability mode",
    );

    const migrationSqlExecutionIndex =
      database.indexOf(
        "transaction.execAsync(migration.sql)",
      );

    const migrationVersionWriteIndex =
      database.indexOf(
        "transaction.execAsync(`PRAGMA user_version = ${migration.version}`)",
      );

    assert.ok(
      database.includes(
        "withExclusiveTransactionAsync",
      )
      && migrationSqlExecutionIndex >= 0
      && migrationVersionWriteIndex >= 0
      && migrationSqlExecutionIndex
        < migrationVersionWriteIndex,
      "SQLite migration version must not advance before migration SQL succeeds",
    );

    assert.ok(
      outbox.includes(
        "withExclusiveTransactionAsync",
      )
      && outbox.includes(
        "idempotency_key",
      )
      && outbox.includes(
        "next_sequence=next_sequence+1",
      ),
      "local transaction acceptance and sequence allocation must remain transactional",
    );

    assert.ok(
      schema.includes(
        "UNIQUE(organization_id,idempotency_key)",
      ),
      "local outbox must reject duplicate organization/idempotency identities",
    );

    assert.ok(
      schema.includes(
        "idx_outbox_device_sequence",
      ),
      "local outbox must preserve unique device sequence indexing",
    );

    assert.ok(
      outbox.includes(
        "Recovered after interrupted sync attempt.",
      ),
      "interrupted SYNCING events must be recoverable",
    );

    assert.ok(
      outboxSync.includes(
        'state: "LOCAL_PENDING"',
      )
      && outboxSync.includes(
        'state: "FAILED"',
      )
      && outboxSync.includes(
        'state: "CONFLICT"',
      ),
      "sync failures must remain explicit durable states",
    );

    assert.doesNotMatch(
      outboxSync,
      /DELETE\s+FROM\s+outbox_events/i,
      "sync must never delete unresolved durable sales",
    );

    assert.ok(
      cacheAdmin.includes(
        "outbox_events, device_sync_state, and sync_cursors are intentionally excluded",
      ),
      "cache cleanup must not delete transaction custody or recovery state",
    );

    assert.ok(
      readiness.includes(
        "validateOfflineAuthorizationGrant",
      )
      && readiness.includes(
        "DEVICE_MISMATCH",
      )
      && readiness.includes(
        "SHIFT_MISMATCH",
      ),
      "offline mutation must retain cached authorization/device/shift validation",
    );

    assert.ok(
      custody.includes(
        "state<>'SYNCED'",
      ),
      "sign-out/context-changing custody must detect all unresolved transactions",
    );

    assert.ok(
      checkout.includes(
        "target_idempotency_key: data.idempotencyKey",
      )
      && checkout.includes(
        "wasReplayed: result.was_replayed",
      ),
      "authoritative checkout must retain stable idempotency replay",
    );

    for (
      const code of [
        "PRICE_CHANGED",
        "TAX_CHANGED",
        "INVENTORY_CONFLICT",
        "DEVICE_REVOKED",
        "CLOSED_SHIFT",
        "PERMISSION_CHANGED",
      ]
    ) {
      assert.ok(
        checkout.includes(code),
        `checkout must classify ${code}`,
      );
    }

    const reserveSequenceIndex =
      offlineCheckout.indexOf(
        'database.rpc("reserve_pos_device_sequence"',
      );

    const authoritativeCheckoutCallIndex =
      offlineCheckout.indexOf(
        "const result=await completeCheckout",
      );

    assert.ok(
      reserveSequenceIndex >= 0
      && authoritativeCheckoutCallIndex >= 0
      && reserveSequenceIndex
        < authoritativeCheckoutCallIndex,
      "device sequence must be reserved before authoritative checkout",
    );

    assert.ok(
      offlineCheckout.includes(
        "finalize_pos_device_sequence",
      ),
      "device sequence must finalize after checkout outcome",
    );

    for (
      const marker of [
        "REPLAY",
        "GAP",
        "DUPLICATE_SEQUENCE",
        "OUT_OF_ORDER",
        "IDEMPOTENCY_SEQUENCE_MISMATCH",
      ]
    ) {
      assert.ok(
        sequenceMigration.includes(
          marker,
        ),
        `server sequence protection must include ${marker}`,
      );
    }

    assert.ok(
      sequenceMigration.includes(
        "unique (organization_id, idempotency_key)",
      ),
      "server sequence receipts must enforce organization/idempotency uniqueness",
    );

    assert.doesNotMatch(
      schema,
      /UPDATE\s+inventory.*SET.*stock/i,
      "mobile local schema must not contain last-write-wins authoritative inventory updates",
    );
  },
);
