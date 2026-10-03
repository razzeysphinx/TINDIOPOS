import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Phase 15 Slice 02 mobile Store Hub config", () => {
  const config = fs.readFileSync(
    "apps/mobile/src/features/store-hub/store-hub-config.ts",
    "utf8",
  );
  const client = fs.readFileSync(
    "apps/mobile/src/features/store-hub/store-hub-client.ts",
    "utf8",
  );
  const schema = fs.readFileSync(
    "apps/mobile/src/db/schema.ts",
    "utf8",
  );
  const settings = fs.readFileSync(
    "apps/mobile/app/(app)/settings.tsx",
    "utf8",
  );

  assert.ok(
    config.includes("secureStorage"),
    "Hub token must use SecureStore",
  );

  assert.ok(
    config.includes("privateIpv4")
    && config.includes('.endsWith(".local")'),
    "Hub URL must be restricted to LAN/local hosts",
  );

  assert.ok(
    client.includes("Authorization: `Bearer ${config.token}`"),
    "Hub client must authenticate with the Store Hub token",
  );

  assert.ok(
    client.includes("body.organizationId !== input.organizationId")
    && client.includes("body.storeId !== input.storeId"),
    "Hub health response must be scope checked",
  );

  assert.ok(
    schema.includes("TINDIO_LOCAL_SCHEMA_VERSION = 7"),
    "Phase 15 must install local schema version 7",
  );

  for (const table of [
    "store_hub_state",
    "store_hub_events",
    "store_hub_publish_state",
  ]) {
    assert.ok(
      schema.includes(table),
      `schema must include ${table}`,
    );
  }

  assert.doesNotMatch(
    schema,
    /hub_token|store_hub_token/i,
    "Hub token must never be stored in SQLite",
  );

  assert.ok(
    settings.includes("PRIVATE LAN ONLY"),
    "Settings must explain Store Hub LAN scope",
  );
});
