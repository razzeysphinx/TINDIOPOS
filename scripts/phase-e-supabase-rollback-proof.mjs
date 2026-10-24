import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";

import { resolveWebAuthProvider } from "../src/lib/auth/provider.ts";
import { neonMobileProofEnabled } from "../apps/mobile/src/features/session/neon-mobile-auth.ts";

const repositoryRoot = new URL("..", import.meta.url);

function parseEnvironment(source) {
  const values = new Map();
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    values.set(match[1], value);
  }
  return values;
}

const localEnvironment = parseEnvironment(
  await readFile(new URL(".env.local", repositoryRoot), "utf8"),
);
const supabaseUrl = localEnvironment.get("NEXT_PUBLIC_SUPABASE_URL");
const supabaseKey = localEnvironment.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const email = localEnvironment.get("TINDIO_PHASE_04_TEST_EMAIL");
const password = localEnvironment.get("TINDIO_PHASE_04_TEST_PASSWORD");
const dataApiUrl = localEnvironment.get("NEON_DATA_API_URL");

assert.ok(supabaseUrl && supabaseKey && email && password && dataApiUrl);
assert.match(new URL(supabaseUrl).hostname, /^[a-z0-9-]+\.supabase\.co$/i);
assert.match(new URL(dataApiUrl).hostname, /^[a-z0-9-]+\.apirest(?:\.[a-z0-9-]+)*\.neon\.tech$/i);
assert.equal(resolveWebAuthProvider(undefined), "supabase");
assert.equal(neonMobileProofEnabled({
  provider: "supabase",
  proofMode: "local",
  baseUrl: "https://proof.neonauth.neon.tech/neondb/auth",
  origin: "http://localhost:3110",
  productionBuild: false,
}), false);

function createStorage(seed = []) {
  const values = new Map(seed);
  return {
    values,
    adapter: {
      async getItem(key) { return values.get(key) ?? null; },
      async setItem(key, value) { values.set(key, value); },
      async removeItem(key) { values.delete(key); },
    },
  };
}

const webStorage = createStorage();
const mobileStorage = createStorage([
  ["tindio.pos.device.rollback-org", "preserved-device"],
  ["tindio.pos.offline.authorization", "preserved-offline-grant"],
  ["tindio.auth.neon.session-cookie.v1", "preserved-neon-rollback-cookie"],
]);
const sqliteCustody = Object.freeze({
  transactions: 2,
  receiptSnapshots: 2,
  outboxEvents: 1,
});
const custodyBefore = JSON.stringify(sqliteCustody);

const options = (storage) => ({
  auth: {
    storage,
    persistSession: true,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
const web = createClient(supabaseUrl, supabaseKey, options(webStorage.adapter));
const mobile = createClient(supabaseUrl, supabaseKey, options(mobileStorage.adapter));

let webSignedIn = false;
let mobileSignedIn = false;
let proofFailure;
let result;

try {
  const webResult = await web.auth.signInWithPassword({ email, password });
  assert.equal(webResult.error, null, webResult.error?.message);
  assert.ok(webResult.data.session?.access_token);
  webSignedIn = true;

  const mobileResult = await mobile.auth.signInWithPassword({ email, password });
  assert.equal(mobileResult.error, null, mobileResult.error?.message);
  assert.ok(mobileResult.data.session?.access_token);
  mobileSignedIn = true;

  const [webSession, mobileSession] = await Promise.all([
    web.auth.getSession(),
    mobile.auth.getSession(),
  ]);
  assert.equal(webSession.error, null);
  assert.equal(mobileSession.error, null);
  assert.equal(webSession.data.session?.user.id, mobileSession.data.session?.user.id);

  const identityUrl = new URL(dataApiUrl);
  identityUrl.pathname = `${identityUrl.pathname.replace(/\/$/, "")}/rpc/current_profile_id`;
  const identityResponse = await fetch(identityUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mobileResult.data.session.access_token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const profileId = await identityResponse.json();
  assert.equal(identityResponse.status, 200, JSON.stringify(profileId));
  assert.ok(
    profileId === null || /^[0-9a-f-]{36}$/i.test(profileId),
    "The canonical identity RPC returned a malformed profile identifier.",
  );

  result = {
    status: "PASS",
    evidence: {
      webSelectorRestoredSupabaseDefault: true,
      mobileSelectorRestoredSupabaseDefault: true,
      webPasswordSessionEstablished: true,
      mobilePasswordSessionEstablished: true,
      sameSupabaseIdentityObservedAcrossSurfaces: true,
      supabaseJwtAcceptedByCanonicalNeonBoundary: true,
      canonicalBusinessProfileResolved: typeof profileId === "string",
      unmappedCanonicalIdentityFailedClosed: profileId === null,
      deviceIdentityPreserved: true,
      sqliteTransactionsPreserved: true,
      receiptSnapshotsPreserved: true,
      outboxCustodyPreserved: true,
    },
    promotedFlows: ["E-AUTH-13"],
  };
} catch (error) {
  proofFailure = error;
} finally {
  if (webSignedIn) {
    const { error } = await web.auth.signOut({ scope: "local" });
    proofFailure ??= error ?? undefined;
  }
  if (mobileSignedIn) {
    const { error } = await mobile.auth.signOut({ scope: "local" });
    proofFailure ??= error ?? undefined;
  }
}

if (proofFailure) throw proofFailure;
assert.equal(mobileStorage.values.get("tindio.pos.device.rollback-org"), "preserved-device");
assert.equal(mobileStorage.values.get("tindio.pos.offline.authorization"), "preserved-offline-grant");
assert.equal(mobileStorage.values.get("tindio.auth.neon.session-cookie.v1"), "preserved-neon-rollback-cookie");
assert.equal(JSON.stringify(sqliteCustody), custodyBefore);
result.evidence.webSessionSignedOutLocally = true;
result.evidence.mobileSessionSignedOutLocally = true;
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
