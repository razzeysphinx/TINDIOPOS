import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  validateStoreHubEvent,
} from "../apps/store-hub/src/protocol.mjs";
import {
  createStoreHubJournal,
} from "../apps/store-hub/src/journal.mjs";

const organizationId =
  "11111111-1111-4111-8111-111111111111";
const storeId =
  "22222222-2222-4222-8222-222222222222";
const deviceId =
  "33333333-3333-4333-8333-333333333333";
const eventId =
  "44444444-4444-4444-8444-444444444444";
const productId =
  "55555555-5555-4555-8555-555555555555";

test("Phase 15 Store Hub journal is durable and idempotent", () => {
  const dataDir = mkdtempSync(
    join(tmpdir(), "tindio-store-hub-"),
  );

  try {
    const parsed = validateStoreHubEvent({
      eventId,
      organizationId,
      storeId,
      deviceId,
      deviceSequence: 1,
      type: "SALE_COMPLETED",
      createdAt: new Date().toISOString(),
      localReference: "OFF-ABC123",
      items: [{
        productId,
        variantId: null,
        quantity: 2,
      }],
      cloudSyncedAt: null,
    });

    assert.equal(parsed.ok, true);

    const journal = createStoreHubJournal({
      dataDir,
      organizationId,
      storeId,
    });

    const first = journal.upsert(parsed.event);
    assert.equal(first.ok, true);
    assert.equal(first.replayed, false);
    assert.equal(first.hubRevision, 1);

    const replay = journal.upsert(parsed.event);
    assert.equal(replay.ok, true);
    assert.equal(replay.replayed, true);
    assert.equal(replay.hubRevision, 1);

    const synced = journal.upsert({
      ...parsed.event,
      cloudSyncedAt: new Date().toISOString(),
    });

    assert.equal(synced.ok, true);
    assert.equal(synced.hubRevision, 2);

    const page = journal.readAfter(0, 100);
    assert.equal(page.changes.length, 2);
    assert.equal(page.nextCursor, 2);

    const contents = readFileSync(
      journal.path,
      "utf8",
    );

    assert.match(contents, /SALE_COMPLETED/);
    assert.doesNotMatch(contents, /customer/i);
    assert.doesNotMatch(contents, /payment/i);
  } finally {
    rmSync(dataDir, {
      recursive: true,
      force: true,
    });
  }
});
