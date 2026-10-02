import assert from "node:assert/strict";

import { TARGET_DATA_API_HOST, writeR8Evidence } from "./common.mjs";

const provider = process.env.TINDIO_DATABASE_PROVIDER;
const dataApiUrl = process.env.NEON_DATA_API_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

assert.equal(provider, "neon", "R8 deployment must retain Neon database mode.");
assert.ok(dataApiUrl, "NEON_DATA_API_URL is required.");
assert.ok(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required.");

const dataApi = new URL(dataApiUrl);
const supabase = new URL(supabaseUrl);
assert.equal(dataApi.hostname, TARGET_DATA_API_HOST, "R8 deployment does not point at the certified target Neon Data API.");

const evidence = {
  generatedAt: new Date().toISOString(),
  provider,
  dataApiHost: dataApi.hostname,
  expectedTargetDataApiHost: TARGET_DATA_API_HOST,
  supabaseAuthHost: supabase.hostname,
  status: "PASS",
};
await writeR8Evidence("deployment-cutover.json", evidence);
console.log(JSON.stringify(evidence, null, 2));
console.log("TINDIO R8 DEPLOYMENT CHECK: PASS");
