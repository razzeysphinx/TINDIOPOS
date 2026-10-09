import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const databaseSource = fs.readFileSync("apps/mobile/src/db/database.ts", "utf8");
const schemaSource = fs.readFileSync("apps/mobile/src/db/schema.ts", "utf8");
const healthSource = fs.readFileSync("apps/mobile/src/db/health.ts", "utf8");
const offlineSaleSource = fs.readFileSync(
  "apps/mobile/src/features/outbox/create-offline-sale.ts",
  "utf8",
);

function configureDurableDatabase(database) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = FULL;
  `);
  assert.equal(database.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  assert.equal(database.prepare("PRAGMA synchronous").get().synchronous, 2);
  assert.equal(database.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
}

function withTemporaryDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tindio-mob-02-"));
  try {
    return run(directory);
  } finally {
    fs.rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  }
}

test("MOB-02 configures and verifies WAL/FULL before using the mobile database", () => {
  assert.match(databaseSource, /PRAGMA journal_mode = WAL/);
  assert.match(databaseSource, /PRAGMA synchronous = FULL/);
  assert.match(databaseSource, /synchronous\?\.synchronous !== TINDIO_SQLITE_SYNCHRONOUS_FULL/);
  assert.match(databaseSource, /foreignKeys\?\.foreign_keys !== 1/);
  assert.match(healthSource, /journalMode === "wal"/);
  assert.match(healthSource, /synchronousMode === TINDIO_SQLITE_SYNCHRONOUS_FULL/);
});

test("MOB-02 awaits close and releases rejected opens for a safe retry", () => {
  assert.match(databaseSource, /await database\.closeAsync\(\)/);
  assert.match(databaseSource, /opening\.catch\(\(\) => \{/);
  assert.match(databaseSource, /if \(databasePromise === opening\) databasePromise = null/);
  assert.match(databaseSource, /if \(closePromise\)/);
});

test("MOB-02 committed custody survives an abrupt process exit without database close", () => {
  withTemporaryDirectory((directory) => {
    const databasePath = path.join(directory, "abrupt-exit.db");
    const childSql = `
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE outbox_events (event_id TEXT PRIMARY KEY, state TEXT NOT NULL, payload_json TEXT NOT NULL);
      CREATE TABLE device_sync_state (device_id TEXT PRIMARY KEY, next_sequence INTEGER NOT NULL);
      CREATE TABLE checkout_intents (intent_id TEXT PRIMARY KEY, state TEXT NOT NULL, payload_json TEXT NOT NULL);
      BEGIN IMMEDIATE;
      INSERT INTO outbox_events VALUES ('event-1','LOCAL_PENDING','{"totalMinor":1250}');
      INSERT INTO device_sync_state VALUES ('device-1',2);
      INSERT INTO checkout_intents VALUES ('intent-1','UNKNOWN','{"idempotencyKey":"intent-1"}');
      COMMIT;
    `;
    const childSource = [
      'const { DatabaseSync } = require("node:sqlite");',
      "const database = new DatabaseSync(process.argv[1]);",
      `database.exec(${JSON.stringify(childSql)});`,
      "process.exit(73);",
    ].join("\n");
    const child = spawnSync(process.execPath, ["-e", childSource, databasePath], {
      encoding: "utf8",
    });
    assert.equal(child.status, 73, child.stderr);

    const verifierSource = [
      'const { DatabaseSync } = require("node:sqlite");',
      "const database = new DatabaseSync(process.argv[1]);",
      'const event = database.prepare("SELECT event_id,state FROM outbox_events").get();',
      'const sequence = database.prepare("SELECT next_sequence FROM device_sync_state").get();',
      'const intent = database.prepare("SELECT state FROM checkout_intents").get();',
      'console.log(JSON.stringify({ event, sequence, intent }));',
      'database.exec("PRAGMA wal_checkpoint(TRUNCATE)");',
      "database.close();",
    ].join("\n");
    const verifier = spawnSync(process.execPath, ["-e", verifierSource, databasePath], {
      encoding: "utf8",
    });
    assert.equal(verifier.status, 0, verifier.stderr);
    assert.deepEqual(JSON.parse(verifier.stdout), {
      event: { event_id: "event-1", state: "LOCAL_PENDING" },
      sequence: { next_sequence: 2 },
      intent: { state: "UNKNOWN" },
    });
  });
});

test("MOB-02 failed atomic acceptance rolls back event and sequence together", () => {
  withTemporaryDirectory((directory) => {
    const database = new DatabaseSync(path.join(directory, "rollback.db"));
    configureDurableDatabase(database);
    database.exec(`
      CREATE TABLE outbox_events (event_id TEXT PRIMARY KEY, device_sequence INTEGER NOT NULL UNIQUE);
      CREATE TABLE device_sync_state (device_id TEXT PRIMARY KEY, next_sequence INTEGER NOT NULL);
      INSERT INTO device_sync_state VALUES ('device-1',1);
    `);

    assert.throws(() => {
      database.exec("BEGIN IMMEDIATE");
      try {
        database.exec(`
          INSERT INTO outbox_events VALUES ('event-1',1);
          UPDATE device_sync_state SET next_sequence=2 WHERE device_id='device-1';
          INSERT INTO outbox_events VALUES ('event-2',1);
          COMMIT;
        `);
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    });

    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 0);
    assert.equal(
      database.prepare("SELECT next_sequence FROM device_sync_state").get().next_sequence,
      1,
    );
    assert.ok(
      offlineSaleSource.indexOf("await enqueueSaleCompletedEvent(")
        < offlineSaleSource.indexOf("return event ? { ok: true, event }"),
      "the cashier success result must only be created after the durable transaction resolves",
    );
    database.close();
  });
});

test("MOB-10 schema 12 to 13 upgrade preserves unresolved transaction custody", () => {
  const migration = schemaSource.match(
    /version: 13,[\s\S]*?sql: `([\s\S]*?)`,\s*\n\s*},/,
  );
  assert.ok(migration, "missing SQLite migration 13");

  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE outbox_events (
      event_id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL,
      state TEXT NOT NULL,
      device_sequence INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      snapshot_json TEXT NOT NULL
    );
    INSERT INTO outbox_events VALUES (
      'event-1','org-1','LOCAL_PENDING',7,'key-1','{"totalMinor":100}','{"version":2}'
    );
    PRAGMA user_version = 12;
  `);

  const before = database.prepare("SELECT * FROM outbox_events").get();
  database.exec("BEGIN IMMEDIATE");
  database.exec(migration[1]);
  database.exec("PRAGMA user_version = 13");
  database.exec("COMMIT");
  const after = database.prepare("SELECT * FROM outbox_events").get();

  assert.deepEqual(after, before);
  assert.equal(database.prepare("PRAGMA user_version").get().user_version, 13);
  assert.equal(
    database.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='index' AND name='idx_outbox_upgrade_custody'",
    ).get().count,
    1,
  );
  assert.doesNotMatch(migration[1], /DELETE|DROP|UPDATE|INSERT/i);
  database.close();
});

test("MOB-02 records a file-backed FULL/WAL transaction benchmark", (context) => {
  withTemporaryDirectory((directory) => {
    const database = new DatabaseSync(path.join(directory, "benchmark.db"));
    configureDurableDatabase(database);
    database.exec("CREATE TABLE durable_writes (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)");

    const transactionCount = 100;
    const insert = database.prepare("INSERT INTO durable_writes VALUES (?,?)");
    const startedAt = performance.now();
    for (let index = 1; index <= transactionCount; index += 1) {
      database.exec("BEGIN IMMEDIATE");
      insert.run(index, `transaction-${index}`);
      database.exec("COMMIT");
    }
    const durationMs = performance.now() - startedAt;

    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM durable_writes").get().count,
      transactionCount,
    );
    assert.ok(Number.isFinite(durationMs) && durationMs > 0);
    context.diagnostic(
      `Host FULL/WAL benchmark: ${transactionCount} commits in ${durationMs.toFixed(2)} ms (${(durationMs / transactionCount).toFixed(2)} ms/commit).`,
    );
    database.close();
  });
});
