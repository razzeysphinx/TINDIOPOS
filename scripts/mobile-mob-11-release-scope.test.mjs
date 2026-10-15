import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("MOB-11 defers Store Hub without deleting retained configuration", () => {
  const scope = read(
    "apps/mobile/src/features/store-hub/store-hub-release-scope.ts",
  );
  const config = read(
    "apps/mobile/src/features/store-hub/store-hub-config.ts",
  );
  const client = read(
    "apps/mobile/src/features/store-hub/store-hub-client.ts",
  );

  assert.match(scope, /DEFERRED_FROM_V1/);
  assert.match(scope, /STORE_HUB_DEFERRED_FROM_RELEASE/);
  assert.match(
    scope,
    /isStoreHubEnabledForRelease\(\)[\s\S]*return false/,
  );

  const readStart = config.indexOf(
    "export async function readStoreHubConfig",
  );
  const readEnd = config.indexOf(
    "export async function clearStoreHubConfig",
  );
  const readBody = config.slice(readStart, readEnd);

  assert.ok(readBody.includes("isStoreHubEnabledForRelease"));
  assert.ok(readBody.includes("return null"));
  assert.doesNotMatch(
    readBody,
    /removeItem/,
    "reading a deferred configuration must not delete it",
  );

  const probeStart = client.indexOf(
    "export async function probeStoreHub",
  );
  const deferredGuard = client.indexOf(
    "if (!isStoreHubEnabledForRelease())",
    probeStart,
  );
  const configRead = client.indexOf(
    "readStoreHubConfig(",
    probeStart,
  );

  assert.ok(deferredGuard > probeStart);
  assert.ok(
    deferredGuard < configRead,
    "deferred releases must stop before reading credentials or starting Hub work",
  );
  assert.match(
    client.slice(deferredGuard, configRead),
    /STORE_HUB_DEFERRED_REASON/,
  );
});

test("MOB-11 release UI communicates the supported isolated-device scope", () => {
  const settings = read(
    "apps/mobile/app/(app)/settings.tsx",
  );
  const syncStatus = read(
    "apps/mobile/app/(app)/sync-status.tsx",
  );
  const androidConfig = read("apps/mobile/app.config.js");

  assert.match(settings, /storeHubEnabled \? \(/);
  assert.match(settings, /Store Hub is not included in this release/);
  assert.match(settings, /previously stored Hub configuration is retained and inactive/);
  assert.match(syncStatus, /storeHubEnabled \? \(/);
  assert.match(syncStatus, /Store Hub is deferred from this release/);
  assert.match(syncStatus, /authoritative cloud reconciliation/);
  assert.match(
    androidConfig,
    /usesCleartextTraffic:\s*allowsDevelopmentCleartext/,
  );
  assert.match(
    androidConfig,
    /EAS_BUILD_PROFILE[\s\S]*=== "development"/,
  );
});

test("MOB-11 deferral preserves the existing Hub implementation for later certification", () => {
  const server = read("apps/store-hub/src/server.mjs");
  const sync = read(
    "apps/mobile/src/features/store-hub/store-hub-sync.ts",
  );

  assert.match(server, /STORE_HUB_SCOPE_MISMATCH/);
  assert.match(server, /TINDIO_STORE_HUB_TLS_CERT_PATH/);
  assert.match(sync, /publishStoreHubEvent/);
  assert.match(sync, /pullStoreHubChanges/);
  assert.doesNotMatch(
    sync,
    /updateOutboxEvent|state:\s*"SYNCED"/,
    "deferred Hub code must retain cloud-ACK separation",
  );
});
