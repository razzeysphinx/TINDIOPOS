import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  TINDIO_AUTH_CLIENT_CAPABILITIES,
  authClientUpgradeRequiredResponse,
  evaluateAuthClientCompatibility,
  parseAuthClientCapabilities,
} from "@tindio/contracts/auth-client-compatibility";

const read = (path) => readFileSync(path, "utf8");
const transition = TINDIO_AUTH_CLIENT_CAPABILITIES.dualAuthTransition;

test("Phase G4 keeps legacy clients supported while the compatibility window is open", () => {
  const decision = evaluateAuthClientCompatibility({
    capabilities: [],
    legacyWindowOpen: true,
    mode: "dual-transition",
  });

  assert.deepEqual(decision, {
    status: "SUPPORTED_LEGACY",
    requiredAuthProvider: "supabase",
    sellingAllowed: true,
    custodyRecoveryAllowed: true,
    preservesRecovery: true,
    requiredCapability: null,
  });
});

test("Phase G4 admits transition-capable clients under the Neon-required policy", () => {
  const capabilities = parseAuthClientCapabilities(`${transition},OFFLINE_CUSTODY_V1,${transition}`);
  const decision = evaluateAuthClientCompatibility({
    capabilities,
    legacyWindowOpen: false,
    mode: "neon-required",
  });

  assert.equal(decision.status, "SUPPORTED_TRANSITION");
  assert.equal(decision.requiredAuthProvider, "neon");
  assert.equal(decision.sellingAllowed, true);
  assert.equal(decision.custodyRecoveryAllowed, true);
});

test("Phase G4 fails closed for old clients without sacrificing recovery", () => {
  const decision = evaluateAuthClientCompatibility({
    capabilities: [],
    legacyWindowOpen: false,
    mode: "neon-required",
  });
  const response = authClientUpgradeRequiredResponse(decision);

  assert.equal(decision.status, "UPGRADE_REQUIRED");
  assert.equal(decision.sellingAllowed, false);
  assert.equal(decision.custodyRecoveryAllowed, true);
  assert.deepEqual(response, {
    ok: false,
    code: "POS_CLIENT_UPGRADE_REQUIRED",
    requiredCapability: transition,
    retryable: false,
    preservesRecovery: true,
    message: "Update TINDIO POS to continue selling. Your session and locally saved transactions remain preserved for recovery.",
  });
});

test("Phase G4 mobile requests declare version, provider, and custody capabilities", () => {
  const api = read("apps/mobile/src/lib/tindio-api.ts");
  assert.match(api, /TINDIO_CLIENT_VERSION_HEADER/);
  assert.match(api, /TINDIO_CLIENT_CAPABILITIES_HEADER/);
  assert.match(api, /TINDIO_AUTH_PROVIDER_HEADER/);
  assert.match(api, /TINDIO_CURRENT_AUTH_CLIENT_CAPABILITIES/);
  assert.match(api, /response\.status === 426/);
  assert.match(api, /TindioClientUpgradeRequiredError/);
});

test("Phase G4 forced upgrades preserve provider sessions and offline custody", () => {
  const session = read("apps/mobile/src/features/session/session-provider.tsx");
  const business = read("apps/mobile/src/features/business/business-context-provider.tsx");
  const guardedBranches = session.match(/if \(isClientUpgradeRequired\(error\)\) \{[\s\S]*?return \{ ok: false, message: error\.message \};[\s\S]*?\}/g) ?? [];

  assert.equal(guardedBranches.length, 2);
  for (const branch of guardedBranches) {
    assert.match(branch, /setSession\(result\.value\)/);
    assert.match(branch, /applyOfflineReadiness\(\)/);
    assert.doesNotMatch(branch, /mobileAuth\.signOut\(\)/);
  }
  assert.match(business, /isClientUpgradeRequired\(caught\)[\s\S]*?loadOffline\(\)[\s\S]*?setError\(caught\.message\)/);
});

test("Phase G4 remains a non-activation slice", () => {
  const provider = read("apps/mobile/src/features/session/auth-provider.ts");
  assert.match(provider, /neonProofEnabled \? \["supabase", "neon"\] : \["supabase"\]/);
  assert.match(provider, /productionBuild: process\.env\.EAS_BUILD_PROFILE === "production"/);
});
