import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (file) => fs.readFileSync(file, "utf8");

async function loadTypeScriptModule(file) {
  const output = ts.transpileModule(read(file), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: file,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const policy = await loadTypeScriptModule(
  "apps/mobile/src/features/outbox/sync-policy.ts",
);
const singleFlight = await loadTypeScriptModule(
  "apps/mobile/src/features/outbox/single-flight.ts",
);
const retry = await loadTypeScriptModule(
  "apps/mobile/src/features/outbox/retry-policy.ts",
);

const outboxSyncSource = read("apps/mobile/src/features/outbox/outbox-sync.ts");
const outboxDbSource = read("apps/mobile/src/db/outbox.ts");
const apiSource = read("apps/mobile/src/lib/tindio-api.ts");
const reconcileSource = read("apps/mobile/src/features/sync/reconcile-cloud.ts");

const event = (sequence, state = "LOCAL_PENDING", nextRetryAt = null) => ({
  eventId: `event-${sequence}`,
  deviceSequence: sequence,
  state,
  nextRetryAt,
});

const successfulAck = (sequence) => ({
  eventId: `event-${sequence}`,
  deviceSequence: sequence,
  status: "SYNCED",
  httpStatus: 200,
  result: {
    ok: true,
    message: "Synced",
    data: { saleId: `sale-${sequence}`, receiptNumber: sequence },
    sync: {
      deviceSequence: sequence,
      serverCheckpoint: sequence,
      expectedSequence: sequence + 1,
      status: "ACCEPTED",
    },
  },
});

test("MOB-03 all concurrent delivery triggers join one device-scoped flight", async () => {
  let executions = 0;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const task = async () => {
    executions += 1;
    await blocked;
    return { completed: 1 };
  };

  const runs = [
    singleFlight.runOutboxSingleFlight("org-a:device-a", task),
    singleFlight.runOutboxSingleFlight("org-a:device-a", task),
    singleFlight.runOutboxSingleFlight("org-a:device-a", task),
    singleFlight.runOutboxSingleFlight("org-a:device-a", task),
  ];
  assert.equal(executions, 0);
  await Promise.resolve();
  assert.equal(executions, 1);
  release();
  assert.deepEqual(await Promise.all(runs), Array(4).fill({ completed: 1 }));

  await singleFlight.runOutboxSingleFlight("org-a:device-a", task);
  assert.equal(executions, 2);
  await assert.rejects(
    singleFlight.runOutboxSingleFlight("org-a:device-b", async () => {
      throw new Error("transport failed");
    }),
  );
  assert.equal(
    await singleFlight.runOutboxSingleFlight("org-a:device-b", async () => "recovered"),
    "recovered",
  );
  assert.match(outboxSyncSource, /syncOutboxEvents[\s\S]*coordinateOutboxSync/);
  assert.match(outboxSyncSource, /syncOutboxBatches[\s\S]*coordinateOutboxSync/);
  assert.match(reconcileSource, /syncOutboxBatches/);
});

test("MOB-03 FIFO selection never skips an earlier backoff or review event", () => {
  const now = "2026-10-08T00:00:00.000Z";
  assert.deepEqual(
    policy.selectOrderedOutboxBatch([
      event(1, "LOCAL_PENDING", "2026-10-08T01:00:00.000Z"),
      event(2),
    ], now),
    [],
  );
  assert.deepEqual(
    policy.selectOrderedOutboxBatch([
      event(1, "CONFLICT"),
      event(2),
    ], now),
    [],
  );
  assert.deepEqual(
    policy.selectOrderedOutboxBatch([event(1), event(2), event(4)], now)
      .map((candidate) => candidate.deviceSequence),
    [1, 2],
  );
});

test("MOB-03 validates the complete ACK envelope before applying terminal state", () => {
  const expected = [event(1), event(2)];
  const valid = {
    ok: true,
    version: 1,
    organizationId: "org-a",
    deviceId: "device-a",
    acks: [successfulAck(1), successfulAck(2)],
    stoppedEarly: false,
  };
  assert.deepEqual(
    policy.validateSyncPushResponse(valid, "org-a", "device-a", expected),
    valid,
  );
  const retry = {
    ...valid,
    acks: [{
      eventId: "event-1",
      deviceSequence: 1,
      status: "RETRY",
      httpStatus: 503,
      result: { ok: false, message: "Retry", retryable: true },
    }],
    stoppedEarly: true,
  };
  assert.deepEqual(
    policy.validateSyncPushResponse(retry, "org-a", "device-a", expected),
    retry,
  );

  for (const malformed of [
    { ...valid, organizationId: "org-b" },
    { ...valid, deviceId: "device-b" },
    { ...valid, acks: [{ ...successfulAck(1), eventId: "wrong-event" }, successfulAck(2)] },
    { ...valid, acks: [{ ...successfulAck(1), deviceSequence: 9 }, successfulAck(2)] },
    { ...valid, acks: [{ ...successfulAck(1), httpStatus: 503 }, successfulAck(2)] },
    { ...valid, acks: [{ ...successfulAck(1), result: { ...successfulAck(1).result, sync: { ...successfulAck(1).result.sync, status: "GAP" } } }, successfulAck(2)] },
    { ...valid, acks: [successfulAck(1)], stoppedEarly: false },
    { ...valid, acks: [{ ...successfulAck(1), result: { ok: true, message: "Missing data" } }, successfulAck(2)] },
  ]) {
    assert.equal(
      policy.validateSyncPushResponse(malformed, "org-a", "device-a", expected),
      null,
    );
  }
});

test("MOB-03 retry delay is bounded, jittered, and respects bounded Retry-After", () => {
  assert.equal(retry.outboxRetryDelayMs(1, 0), 800);
  assert.equal(retry.outboxRetryDelayMs(1, 1), 1200);
  assert.equal(retry.outboxRetryDelayMs(20, 1), 60000);
  const now = Date.parse("2026-10-08T00:00:00.000Z");
  assert.equal(
    retry.nextOutboxRetryAt(1, now, 120000, 0),
    "2026-10-08T00:02:00.000Z",
  );
  assert.equal(
    retry.nextOutboxRetryAt(1, now, 900000, 0),
    "2026-10-08T00:05:00.000Z",
  );
});

test("MOB-03 recovery, timeout, and stable identity contracts remain fail-safe", () => {
  assert.match(outboxDbSource, /state = 'SYNCING'/);
  assert.doesNotMatch(outboxDbSource, /state = 'SYNCING' AND last_attempt_at/);
  assert.match(outboxDbSource, /throw new Error\("OUTBOX_ROW_CORRUPT"\)/);
  assert.match(outboxSyncSource, /OUTBOX_TRANSPORT_TIMEOUT_MS = 15_000/);
  assert.match(outboxSyncSource, /controller\.abort\(\)/);
  assert.match(outboxSyncSource, /eventId: event\.eventId/);
  assert.match(outboxSyncSource, /checkout: event\.payload\.checkout/);
  assert.match(outboxSyncSource, /deviceSequence: event\.deviceSequence/);
  assert.match(outboxSyncSource, /validateSyncPushResponse\(/);
  assert.match(apiSource, /retry-after/);
  assert.match(apiSource, /retryAfterMs/);
  assert.match(outboxSyncSource, /error\.status !== 429/);
  assert.match(outboxSyncSource, /state: "CONFLICT"/);
  assert.doesNotMatch(outboxSyncSource, /DELETE\s+FROM\s+outbox_events/i);
});
