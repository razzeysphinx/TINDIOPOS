import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shared device contracts retain their wire and validation rules", async () => {
  const contract = await read("packages/contracts/src/device.ts");

  for (const field of [
    "deviceId",
    "storeId",
    "registerId",
    "deviceName",
    "appVersion",
    "lastSeenAt",
    "serverCheckpoint",
    "nextExpectedSequence",
  ]) {
    assert.match(contract, new RegExp(`\\b${field}\\b`));
  }

  assert.match(contract, /\^\[0-9a-fA-F\]\{64\}\$/);
  assert.match(contract, /DEVICE_UNAVAILABLE_ACCEPT_BOUNDED_LOSS/);
  assert.match(contract, /ACCEPT LOCAL-ONLY TRANSACTION LOSS/);
  assert.match(contract, /x-tindio-device-id/);
  assert.match(contract, /x-tindio-device-secret/);
  assert.match(contract, /x-tindio-app-version/);
  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("Web facades preserve existing device contract import paths", async () => {
  const [deviceFacade, posFacade, deviceRuntime] = await Promise.all([
    read("src/features/devices/device-schema.ts"),
    read("src/contracts/pos.ts"),
    read("src/features/devices/pos-device.ts"),
  ]);

  assert.match(deviceFacade, /TINDIO_POS_APP_VERSION\s*=\s*["']web-0\.1\.0["']/);
  assert.match(deviceFacade, /from ["']@tindio\/contracts["']/);
  assert.doesNotMatch(deviceFacade, /from ["']zod["']/);
  assert.match(posFacade, /PosDeviceValidationResponse/);
  assert.match(posFacade, /PosOfflineSequenceInfo/);
  assert.match(posFacade, /from ["']@tindio\/contracts["']/);
  assert.doesNotMatch(posFacade, /export type PosDeviceBinding\s*=/);
  assert.doesNotMatch(deviceRuntime, /export type PosDeviceBinding\s*=/);
});

test("Mobile consumes device contracts through the workspace package", async () => {
  const [manifestSource, deviceStore, api, outbox] = await Promise.all([
    read("apps/mobile/package.json"),
    read("apps/mobile/src/features/device/device-store.ts"),
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("apps/mobile/src/features/outbox/outbox-sync.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.dependencies["@tindio/contracts"], "workspace:*");
  for (const source of [deviceStore, api, outbox]) {
    assert.match(source, /from ["']@tindio\/contracts["']/);
  }
  assert.doesNotMatch(deviceStore, /src\/contracts\/pos/);
});
