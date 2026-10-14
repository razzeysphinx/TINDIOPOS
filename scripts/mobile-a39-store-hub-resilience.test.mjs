import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import ts from "typescript";

const organizationId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const otherStoreId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const deviceId = "33333333-3333-4333-8333-333333333333";
const eventId = "44444444-4444-4444-8444-444444444444";
const productId = "55555555-5555-4555-8555-555555555555";
const token = "A39-store-hub-behavioral-token-2026";

const event = {
  eventId,
  organizationId,
  storeId,
  deviceId,
  deviceSequence: 17,
  type: "SALE_COMPLETED",
  createdAt: "2026-10-14T00:00:00.000Z",
  localReference: "OFF-A39TEST001",
  items: [{ productId, variantId: null, quantity: 2 }],
  cloudSyncedAt: null,
};

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function headers(authToken = token) {
  return {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  };
}

async function startHub({ dataDir, port }) {
  const child = spawn(process.execPath, ["apps/store-hub/src/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TINDIO_STORE_HUB_ORGANIZATION_ID: organizationId,
      TINDIO_STORE_HUB_STORE_ID: storeId,
      TINDIO_STORE_HUB_TOKEN: token,
      TINDIO_STORE_HUB_PORT: String(port),
      TINDIO_STORE_HUB_HOST: "127.0.0.1",
      TINDIO_STORE_HUB_DATA_DIR: dataDir,
      TINDIO_STORE_HUB_ALLOW_INSECURE_HTTP: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      assert.fail(`Store Hub exited during startup: ${stderr}`);
    }
    try {
      const response = await fetch(`${endpoint}/health`, {
        headers: headers(),
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return { child, endpoint };
    } catch {
      // The listener may not be ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill();
  assert.fail(`Store Hub did not become ready: ${stderr}`);
}

async function stopHub(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([
    exited,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Store Hub did not stop")), 5_000),
    ),
  ]);
}

async function postEvent(endpoint, body, authToken = token) {
  const response = await fetch(`${endpoint}/v1/events`, {
    method: "POST",
    headers: headers(authToken),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(2_000),
  });
  return { response, body: await response.json() };
}

async function loadTypeScriptModule(file) {
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("A39 Hub restart preserves its journal and duplicate ACK is idempotent", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "tindio-a39-hub-"));
  const port = await availablePort();
  let running;

  try {
    running = await startHub({ dataDir, port });

    const unauthorized = await fetch(`${running.endpoint}/health`, {
      headers: headers("wrong-token-that-is-still-long-enough-2026"),
    });
    assert.equal(unauthorized.status, 401);
    assert.equal((await unauthorized.json()).reason, "STORE_HUB_UNAUTHORIZED");

    const wrongScope = await postEvent(running.endpoint, {
      ...event,
      storeId: otherStoreId,
    });
    assert.equal(wrongScope.response.status, 403);
    assert.equal(wrongScope.body.reason, "STORE_HUB_SCOPE_MISMATCH");

    const accepted = await postEvent(running.endpoint, event);
    assert.equal(accepted.response.status, 200);
    assert.deepEqual(accepted.body, {
      ok: true,
      replayed: false,
      hubRevision: 1,
    });

    const duplicate = await postEvent(running.endpoint, event);
    assert.equal(duplicate.response.status, 200);
    assert.deepEqual(duplicate.body, {
      ok: true,
      replayed: true,
      hubRevision: 1,
    });

    await stopHub(running.child);
    running = await startHub({ dataDir, port });

    const health = await fetch(`${running.endpoint}/health`, {
      headers: headers(),
    }).then((response) => response.json());
    assert.equal(health.currentRevision, 1);

    const page = await fetch(`${running.endpoint}/v1/events?after=0&limit=100`, {
      headers: headers(),
    }).then((response) => response.json());
    assert.equal(page.currentRevision, 1);
    assert.equal(page.changes.length, 1);
    assert.deepEqual(page.changes[0].event, event);

    const replayAfterRestart = await postEvent(running.endpoint, event);
    assert.equal(replayAfterRestart.body.replayed, true);
    assert.equal(replayAfterRestart.body.hubRevision, 1);

    const cloudUpdate = await postEvent(running.endpoint, {
      ...event,
      cloudSyncedAt: "2026-10-14T01:00:00.000Z",
    });
    assert.equal(cloudUpdate.body.replayed, false);
    assert.equal(cloudUpdate.body.hubRevision, 2);

    const duplicateCloudAck = await postEvent(running.endpoint, {
      ...event,
      cloudSyncedAt: "2026-10-14T01:00:00.000Z",
    });
    assert.equal(duplicateCloudAck.body.replayed, true);
    assert.equal(duplicateCloudAck.body.hubRevision, 2);

    const journal = readFileSync(
      join(dataDir, `store-hub-${organizationId}-${storeId}.jsonl`),
      "utf8",
    );
    assert.doesNotMatch(journal, /customer|payment|receipt/i);
  } finally {
    if (running?.child) await stopHub(running.child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("A39 Hub acknowledgements cannot become cloud acknowledgements", () => {
  const sync = readFileSync(
    "apps/mobile/src/features/store-hub/store-hub-sync.ts",
    "utf8",
  );
  const cache = readFileSync(
    "apps/mobile/src/db/store-hub-cache.ts",
    "utf8",
  );
  const client = readFileSync(
    "apps/mobile/src/features/store-hub/store-hub-client.ts",
    "utf8",
  );

  assert.doesNotMatch(sync, /updateOutboxEvent|state:\s*"SYNCED"/);
  assert.match(client, /body\.organizationId !== input\.organizationId/);
  assert.match(client, /body\.storeId !== input\.storeId/);
  assert.match(cache, /assertOrganizationScope/);
  assert.match(cache, /assertStoreScope/);
  assert.doesNotMatch(cache, /DELETE FROM outbox_events|DELETE FROM receipt_summaries|DELETE FROM checkout_intents|DELETE FROM recovery/i);
});

test("A39 replacement Hub resets only replica state before republishing", async () => {
  const policy = await loadTypeScriptModule(
    "apps/mobile/src/features/store-hub/store-hub-replica-policy.ts",
  );

  assert.deepEqual(
    policy.evaluateStoreHubReplicaContinuity({
      state: null,
      endpoint: "http://127.0.0.1:8787",
      currentRevision: 0,
    }),
    { reset: false, reason: null },
  );

  assert.deepEqual(
    policy.evaluateStoreHubReplicaContinuity({
      state: { hubUrl: "http://127.0.0.1:8787", pullCursor: 1000 },
      endpoint: "http://127.0.0.1:8787",
      currentRevision: 0,
    }),
    { reset: true, reason: "CURSOR_AHEAD" },
  );

  assert.deepEqual(
    policy.evaluateStoreHubReplicaContinuity({
      state: { hubUrl: "http://127.0.0.1:8787", pullCursor: 4 },
      endpoint: "http://127.0.0.1:8788",
      currentRevision: 4,
    }),
    { reset: true, reason: "ENDPOINT_CHANGED" },
  );

  assert.deepEqual(
    policy.evaluateStoreHubReplicaContinuity({
      state: { hubUrl: "http://127.0.0.1:8787", pullCursor: 4 },
      endpoint: "http://127.0.0.1:8787",
      currentRevision: 4,
    }),
    { reset: false, reason: null },
  );

  const sync = readFileSync(
    "apps/mobile/src/features/store-hub/store-hub-sync.ts",
    "utf8",
  );
  const cache = readFileSync(
    "apps/mobile/src/db/store-hub-cache.ts",
    "utf8",
  );
  const resetBeforeOutbox = sync.indexOf("resetStoreHubReplicaState(scope)");
  const outboxRead = sync.indexOf("SELECT event_id,organization_id");
  assert.ok(resetBeforeOutbox >= 0 && resetBeforeOutbox < outboxRead);
  assert.match(cache, /DELETE FROM store_hub_events/);
  assert.match(cache, /DELETE FROM store_hub_publish_state/);
  assert.match(cache, /DELETE FROM store_hub_state/);
});
