import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

async function loadProviderContract() {
  const input = await source("src/lib/database/provider-contract.ts");
  const output = ts.transpileModule(input, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("hosted database provider contract fails closed and accepts the explicit Neon target", async () => {
  const { resolveDatabaseProvider } = await loadProviderContract();

  assert.throws(
    () => resolveDatabaseProvider({ VERCEL_ENV: "production" }),
    /explicit TINDIO_DATABASE_PROVIDER/,
  );
  assert.throws(
    () => resolveDatabaseProvider({ VERCEL_ENV: "production", TINDIO_DATABASE_PROVIDER: "supabase" }),
    /must use the Neon database provider/,
  );
  assert.throws(
    () => resolveDatabaseProvider({ VERCEL_ENV: "production", TINDIO_DATABASE_PROVIDER: "neon" }),
    /requires a valid server-side NEON_DATA_API_URL/,
  );
  assert.equal(
    resolveDatabaseProvider({
      VERCEL_ENV: "production",
      TINDIO_DATABASE_PROVIDER: "neon",
      NEON_DATA_API_URL: "https://example.test/rest/v1",
    }),
    "neon",
  );
  assert.equal(resolveDatabaseProvider({}), "supabase");
});

test("the kitchen forward migration records durable events and removes provider database calls", async () => {
  const [migration, kitchenDisplay] = await Promise.all([
    source("database/migrations/0012_provider_neutral_realtime_dispatch.sql"),
    source("src/features/kitchen/kitchen-display.tsx"),
  ]);

  assert.match(migration, /create table if not exists private\.kitchen_order_change_events/i);
  assert.match(migration, /on conflict \(kitchen_order_id, status, source_updated_at\) do nothing/i);
  assert.doesNotMatch(migration, /\brealtime\s*\./i);
  assert.doesNotMatch(kitchenDisplay, /kitchenOrderChannel|RealtimeChannel/);
  assert.match(kitchenDisplay, /setInterval\(\(\) => router\.refresh\(\), 15_000\)/);
});
