import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  NEON_MOBILE_AUTH_COOKIE_KEY,
  supabaseMobileAuthStorageKey,
} from "../apps/mobile/src/features/session/auth-storage-keys.ts";
import {
  canRetireInactiveMobileAuthSession,
  inspectMobileAuthTransition,
  MOBILE_AUTH_PROVIDER_MARKER_KEY,
  recordVerifiedMobileAuthProvider,
} from "../apps/mobile/src/features/session/auth-transition.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const legacyKey = supabaseMobileAuthStorageKey("https://project-ref.supabase.co");

function memoryStorage(initial = []) {
  const values = new Map(initial);
  const removals = [];
  return {
    values,
    removals,
    storage: {
      async getItem(key) { return values.get(key) ?? null; },
      async setItem(key, value) { values.set(key, value); },
      async removeItem(key) { removals.push(key); values.delete(key); },
    },
  };
}

test("G2 recognizes the existing Supabase session without renaming or deleting it", async () => {
  assert.equal(legacyKey, "sb-project-ref-auth-token");
  const memory = memoryStorage([[legacyKey, "legacy-session"]]);
  const current = await inspectMobileAuthTransition({
    neonStorageKey: NEON_MOBILE_AUTH_COOKIE_KEY,
    storage: memory.storage,
    supabaseStorageKey: legacyKey,
    targetProvider: "supabase",
  });
  const transition = await inspectMobileAuthTransition({
    neonStorageKey: NEON_MOBILE_AUTH_COOKIE_KEY,
    storage: memory.storage,
    supabaseStorageKey: legacyKey,
    targetProvider: "neon",
  });
  assert.equal(current.state, "SUPABASE_ACTIVE");
  assert.equal(transition.state, "NEON_REAUTHENTICATION_REQUIRED");
  assert.equal(transition.legacySupabaseSessionPresent, true);
  assert.equal(transition.preservesLegacySession, true);
  assert.deepEqual(memory.removals, []);
  assert.equal(memory.values.get(legacyKey), "legacy-session");
});

test("G2 verifies Neon separately and never retires legacy custody implicitly", async () => {
  const memory = memoryStorage([
    [legacyKey, "legacy-session"],
    [NEON_MOBILE_AUTH_COOKIE_KEY, "neon-session"],
    ["tindio.device.org-1", "device-enrollment"],
    ["tindio.offline.authorization.v1", "offline-grant"],
  ]);
  const snapshot = await inspectMobileAuthTransition({
    neonStorageKey: NEON_MOBILE_AUTH_COOKIE_KEY,
    storage: memory.storage,
    supabaseStorageKey: legacyKey,
    targetProvider: "neon",
  });
  assert.equal(snapshot.state, "NEON_ACTIVE");
  await recordVerifiedMobileAuthProvider({ provider: "neon", storage: memory.storage });
  assert.equal(memory.values.get(MOBILE_AUTH_PROVIDER_MARKER_KEY), "neon");
  assert.equal(memory.values.get(legacyKey), "legacy-session");
  assert.equal(memory.values.get("tindio.device.org-1"), "device-enrollment");
  assert.equal(memory.values.get("tindio.offline.authorization.v1"), "offline-grant");
  assert.deepEqual(memory.removals, []);

  const common = { snapshot, activeIdentityVerified: true, custodyReleasable: true };
  assert.equal(canRetireInactiveMobileAuthSession({ ...common, ownerApproved: false }), false);
  assert.equal(canRetireInactiveMobileAuthSession({ ...common, ownerApproved: true }), true);
  assert.deepEqual(memory.removals, []);
});

test("G2 wiring verifies online identity before marking it and retains the custody gate", async () => {
  const [session, transition, supabase, neon, evidence, packageSource] = await Promise.all([
    read("apps/mobile/src/features/session/session-provider.tsx"),
    read("apps/mobile/src/features/session/auth-transition.ts"),
    read("apps/mobile/src/lib/supabase.ts"),
    read("apps/mobile/src/features/session/neon-mobile-auth.ts"),
    read("docs/architecture/TINDIO_PHASE_G_MOBILE_AUTH_TRANSITION_PROOF.json"),
    read("package.json"),
  ]);
  assert.ok(session.indexOf("await fetchPosV2Core()") < session.indexOf("await recordVerifiedMobileAuthProvider"));
  assert.ok(session.indexOf("canReleaseTransactionCustody") < session.indexOf("await mobileAuth.signOut()"));
  assert.match(supabase, /storageKey: SUPABASE_MOBILE_AUTH_STORAGE_KEY/);
  assert.match(neon, new RegExp(NEON_MOBILE_AUTH_COOKIE_KEY.replaceAll(".", "\\.")));
  assert.doesNotMatch(transition, /removeItem|\.\.\/\.\.\/db|device-store|receipt-cache|outbox/);
  const proof = JSON.parse(evidence);
  assert.equal(proof.productionChangesMade, false);
  assert.equal(proof.legacySessionDeletionImplemented, false);
  assert.equal(proof.webActivation.status, "BLOCKED_BY_F1_IDENTITY_RECONCILIATION");
  assert.equal(
    JSON.parse(packageSource).scripts["test:architecture-phase-g-mobile-auth-transition"],
    "node --test scripts/architecture-phase-g-mobile-auth-transition-check.mjs",
  );
});
