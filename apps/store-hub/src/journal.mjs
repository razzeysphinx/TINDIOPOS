import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { immutableEventSignature } from "./protocol.mjs";

function appendDurably(path, line) {
  const fd = openSync(path, "a", 0o600);

  try {
    writeSync(fd, `${line}\n`, null, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function createStoreHubJournal({
  dataDir,
  organizationId,
  storeId,
}) {
  mkdirSync(dataDir, { recursive: true });

  const path = join(
    dataDir,
    `store-hub-${organizationId}-${storeId}.jsonl`,
  );

  const changes = [];
  const latestByEventId = new Map();
  let revision = 0;

  if (existsSync(path)) {
    const raw = readFileSync(path, "utf8");

    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;

      try {
        const record = JSON.parse(line);

        if (
          !Number.isSafeInteger(record.hubRevision)
          || record.hubRevision < 1
          || !record.event?.eventId
        ) {
          continue;
        }

        revision = Math.max(revision, record.hubRevision);
        changes.push(record);
        latestByEventId.set(record.event.eventId, record);
      } catch {
        // Invalid/truncated historical lines are ignored.
        // New writes remain durable and append-only.
      }
    }

    changes.sort((left, right) =>
      left.hubRevision - right.hubRevision
    );
  }

  function upsert(event) {
    const existing = latestByEventId.get(event.eventId);

    if (existing) {
      if (
        immutableEventSignature(existing.event)
        !== immutableEventSignature(event)
      ) {
        return {
          ok: false,
          reason: "EVENT_IDENTITY_CONFLICT",
        };
      }

      if (existing.event.cloudSyncedAt === event.cloudSyncedAt) {
        return {
          ok: true,
          replayed: true,
          hubRevision: existing.hubRevision,
        };
      }
    }

    revision += 1;

    const record = {
      hubRevision: revision,
      acceptedAt: new Date().toISOString(),
      event,
    };

    appendDurably(path, JSON.stringify(record));
    changes.push(record);
    latestByEventId.set(event.eventId, record);

    return {
      ok: true,
      replayed: false,
      hubRevision: revision,
    };
  }

  function readAfter(cursor, limit) {
    const page = changes
      .filter((record) => record.hubRevision > cursor)
      .slice(0, limit);

    const nextCursor = page.length
      ? page[page.length - 1].hubRevision
      : cursor;

    return {
      changes: page,
      nextCursor,
      hasMore: changes.some(
        (record) => record.hubRevision > nextCursor,
      ),
      currentRevision: revision,
    };
  }

  return {
    path,
    get revision() {
      return revision;
    },
    upsert,
    readAfter,
  };
}
