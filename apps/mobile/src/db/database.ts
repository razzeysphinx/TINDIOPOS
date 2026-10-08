import * as SQLite from "expo-sqlite";

import {
  LOCAL_MIGRATIONS,
  TINDIO_DATABASE_NAME,
  TINDIO_LOCAL_SCHEMA_VERSION,
} from "./schema";

export const TINDIO_SQLITE_SYNCHRONOUS_FULL = 2;

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
let closePromise: Promise<void> | null = null;

async function assertDurableConnection(database: SQLite.SQLiteDatabase) {
  const [journal, synchronous, foreignKeys] = await Promise.all([
    database.getFirstAsync<{ journal_mode: string }>("PRAGMA journal_mode"),
    database.getFirstAsync<{ synchronous: number }>("PRAGMA synchronous"),
    database.getFirstAsync<{ foreign_keys: number }>("PRAGMA foreign_keys"),
  ]);

  if (
    journal?.journal_mode.toLowerCase() !== "wal"
    || synchronous?.synchronous !== TINDIO_SQLITE_SYNCHRONOUS_FULL
    || foreignKeys?.foreign_keys !== 1
  ) {
    throw new Error("SQLite durable connection configuration could not be verified.");
  }
}

async function migrateDatabase(database: SQLite.SQLiteDatabase) {
  let current = (
    await database.getFirstAsync<{ user_version: number }>("PRAGMA user_version")
  )?.user_version ?? 0;

  for (const migration of LOCAL_MIGRATIONS) {
    if (migration.version <= current) continue;

    await database.withExclusiveTransactionAsync(async (transaction) => {
      if (migration.version === 5) {
        const columns = await transaction.getAllAsync<{ name: string }>(
          "PRAGMA table_info(outbox_events)",
        );
        if (!columns.some((column) => column.name === "device_sequence")) {
          await transaction.execAsync(
            "ALTER TABLE outbox_events ADD COLUMN device_sequence INTEGER",
          );
        }
      }

      await transaction.execAsync(migration.sql);
      await transaction.execAsync(`PRAGMA user_version = ${migration.version}`);
      await transaction.runAsync(
        "INSERT INTO local_metadata (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        "schema_version",
        String(migration.version),
        new Date().toISOString(),
      );
    });
    current = migration.version;
  }

  if (current !== TINDIO_LOCAL_SCHEMA_VERSION) {
    throw new Error(`Unexpected local schema version ${current}.`);
  }
}

async function openDatabase() {
  const database = await SQLite.openDatabaseAsync(TINDIO_DATABASE_NAME);

  try {
    await database.execAsync(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;",
    );
    await assertDurableConnection(database);
    await migrateDatabase(database);
    return database;
  } catch (error) {
    await database.closeAsync().catch(() => undefined);
    throw error;
  }
}

function startDatabaseOpen() {
  const opening = openDatabase();
  databasePromise = opening;
  void opening.catch(() => {
    if (databasePromise === opening) databasePromise = null;
  });
  return opening;
}

export function getTindioDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (closePromise) {
    return closePromise.then(() => getTindioDatabase());
  }
  return databasePromise ?? startDatabaseOpen();
}

export async function closeTindioDatabase() {
  if (closePromise) {
    await closePromise;
    return;
  }

  const opening = databasePromise;
  if (!opening) return;

  const closing = (async () => {
    const database = await opening;
    await database.closeAsync();
    if (databasePromise === opening) databasePromise = null;
  })();
  closePromise = closing;

  try {
    await closing;
  } finally {
    if (closePromise === closing) closePromise = null;
  }
}

export async function getLocalSchemaVersion() {
  return (await getTindioDatabase())
    .getFirstAsync<{ user_version: number }>("PRAGMA user_version")
    .then((row) => row?.user_version ?? 0);
}

export async function writeLocalMetadata(key: string, value: string) {
  await (await getTindioDatabase()).runAsync(
    "INSERT INTO local_metadata (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
    key,
    value,
    new Date().toISOString(),
  );
}

export async function readLocalMetadata(key: string) {
  return (await getTindioDatabase()).getFirstAsync<{
    value: string;
    updated_at: string;
  }>(
    "SELECT value,updated_at FROM local_metadata WHERE key = ?",
    key,
  );
}
