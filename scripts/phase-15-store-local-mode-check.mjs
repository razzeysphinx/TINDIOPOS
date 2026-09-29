import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Phase 15 Store Local Mode implementation contract", () => {
  const provider = fs.readFileSync(
    "apps/mobile/src/features/business/business-context-provider.tsx",
    "utf8",
  );
  const sync = fs.readFileSync(
    "apps/mobile/src/features/store-hub/store-hub-sync.ts",
    "utf8",
  );
  const hubServer = fs.readFileSync(
    "apps/store-hub/src/server.mjs",
    "utf8",
  );
  const schema = fs.readFileSync(
    "apps/mobile/src/db/schema.ts",
    "utf8",
  );
  const outbox = fs.readFileSync(
    "apps/mobile/src/features/outbox/outbox-types.ts",
    "utf8",
  );
  const status = fs.readFileSync(
    "apps/mobile/app/(app)/sync-status.tsx",
    "utf8",
  );

  for (const mode of [
    "CLOUD_ONLINE",
    "STORE_LOCAL",
    "DEVICE_ISOLATED",
  ]) {
    assert.ok(
      provider.includes(mode),
      `provider must expose ${mode}`,
    );
  }

  assert.ok(
    provider.includes("probeStoreHub")
    && provider.includes("synchronizeWithStoreHub"),
    "offline fallback must probe and coordinate with Store Hub",
  );

  assert.ok(
    hubServer.includes("STORE_HUB_SCOPE_MISMATCH"),
    "Store Hub must enforce configured organization/store scope",
  );

  assert.ok(
    sync.includes("publishStoreHubEvent")
    && sync.includes("pullStoreHubChanges"),
    "mobile must publish and pull Store Hub events",
  );

  assert.doesNotMatch(
    sync,
    /updateOutboxEvent|state:\s*"SYNCED"/,
    "Store Hub must never mark cloud outbox synced",
  );

  assert.equal(
    /export type OutboxOperationType\s*=\s*"SALE_COMPLETED"/.test(outbox),
    true,
    "Phase 15 must not expand the cloud outbox operation set",
  );

  assert.ok(
    schema.includes("TINDIO_LOCAL_SCHEMA_VERSION = 7"),
    "Phase 15 local schema must remain version 7",
  );

  assert.ok(
    status.includes("Store Hub ACK never replaces cloud ACK."),
    "Sync Status must communicate Hub/cloud acknowledgement separation",
  );
});
