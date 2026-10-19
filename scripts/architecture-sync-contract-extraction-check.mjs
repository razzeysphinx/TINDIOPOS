import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shared sync-control contracts retain exact discriminants and scope fields", async () => {
  const contract = await read("packages/contracts/src/sync-control.ts");

  for (const value of [
    "CATALOG",
    "REFERENCE",
    "CUSTOMER",
    "DEVICE",
    "MODIFIERS",
    "SYNC_CURSOR_EXPIRED",
  ]) {
    assert.match(contract, new RegExp(`["']${value}["']`));
  }

  for (const field of [
    "organizationId",
    "deviceId",
    "storeId",
    "serverRevision",
    "fromCursor",
    "retainedAfterRevision",
    "registerId",
    "deviceName",
    "appVersion",
    "lastSeenAt",
  ]) {
    assert.match(contract, new RegExp(`\\b${field}\\b`));
  }

  assert.match(contract, /ok:\s*false/);
  assert.match(contract, /version:\s*1/);
  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("root POS contract remains the compatibility facade", async () => {
  const facade = await read("src/contracts/pos.ts");

  for (const typeName of [
    "PosDeviceDelta",
    "PosSyncBaselineResponse",
    "PosSyncCursorExpiredResponse",
    "PosSyncDomain",
  ]) {
    assert.match(facade, new RegExp(`\\b${typeName}\\b`));
    assert.doesNotMatch(facade, new RegExp(`export type ${typeName}\\s*=`));
  }
  assert.match(facade, /from ["']@tindio\/contracts["']/);
});

test("matching Mobile sync consumers use the workspace contract", async () => {
  const [api, applyDeviceDelta] = await Promise.all([
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("apps/mobile/src/features/sync/apply-device-delta.ts"),
  ]);

  assert.match(api, /PosSyncBaselineResponse/);
  assert.match(api, /PosSyncCursorExpiredResponse/);
  assert.match(api, /from ["']@tindio\/contracts["']/);
  assert.match(applyDeviceDelta, /from ["']@tindio\/contracts["']/);
  assert.doesNotMatch(applyDeviceDelta, /src\/contracts\/pos/);
});
