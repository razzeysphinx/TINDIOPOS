import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => fs.readFileSync(path, "utf8");

async function loadTypeScriptModule(file) {
  const output = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const policy = await loadTypeScriptModule("apps/mobile/src/features/offline/lifecycle-policy.ts");
const coordinatorModule = await loadTypeScriptModule("apps/mobile/src/features/offline/foreground-reload-coordinator.ts");
const businessSource = read("apps/mobile/src/features/business/business-context-provider.tsx");
const sessionSource = read("apps/mobile/src/features/session/session-provider.tsx");
const renewalSource = read("apps/mobile/src/features/offline/renew-offline-authorization.ts");
const readinessSource = read("apps/mobile/src/features/offline/offline-readiness.ts");
const deviceSetupSource = read("apps/mobile/src/features/device/device-setup.tsx");
const homeSource = read("apps/mobile/app/(app)/index.tsx");

test("MOB-09 cloud entry recovers unresolved, previously isolated, and unprepared terminals", () => {
  const base = {
    previousMode: "CLOUD_ONLINE",
    unresolvedTransactions: 0,
    terminalEnrolled: true,
    syncCursorInitialized: true,
  };
  assert.equal(policy.shouldRecoverCloudEntry(base), false);
  assert.equal(policy.shouldRecoverCloudEntry({ ...base, unresolvedTransactions: 1 }), true);
  assert.equal(policy.shouldRecoverCloudEntry({ ...base, previousMode: "DEVICE_ISOLATED" }), true);
  assert.equal(policy.shouldRecoverCloudEntry({ ...base, previousMode: "STORE_LOCAL" }), true);
  assert.equal(policy.shouldRecoverCloudEntry({ ...base, syncCursorInitialized: false }), true);
  assert.equal(policy.shouldRecoverCloudEntry({ ...base, terminalEnrolled: false, syncCursorInitialized: false }), false);
});

test("MOB-09 resume probing runs only on a transition into foreground", () => {
  assert.equal(policy.shouldReloadAfterAppStateChange("background", "active"), true);
  assert.equal(policy.shouldReloadAfterAppStateChange("inactive", "active"), true);
  assert.equal(policy.shouldReloadAfterAppStateChange("active", "active"), false);
  assert.equal(policy.shouldReloadAfterAppStateChange("active", "background"), false);
});

test("MOB-09 foreground recovery queues one trailing run when session state changes", async () => {
  const calls = [];
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const coordinator = coordinatorModule.createForegroundReloadCoordinator(async (organizationId) => {
    calls.push(organizationId);
    if (calls.length === 1) await blocked;
    return organizationId;
  });
  const first = coordinator.run("org-offline");
  await Promise.resolve();
  coordinator.setTask(async (organizationId) => {
    calls.push(`new:${organizationId}`);
    return organizationId;
  });
  const trailingA = coordinator.run("org-online-a");
  const trailingB = coordinator.run("org-online-b");
  assert.equal(trailingA, trailingB);
  assert.deepEqual(calls, ["org-offline"]);
  release();
  assert.equal(await first, "org-offline");
  assert.equal(await trailingA, "org-online-b");
  assert.deepEqual(calls, ["org-offline", "new:org-online-b"]);

  assert.match(businessSource, /createForegroundReloadCoordinator/);
  assert.match(businessSource, /reloadCoordinator\.setTask\(performReload\)/);
  assert.match(businessSource, /AppState\.addEventListener\("change"/);
  assert.match(businessSource, /shouldReloadAfterAppStateChange[\s\S]*void reload/);
  assert.match(sessionSource, /recoverSessionOnForeground/);
  assert.match(sessionSource, /supabase\.auth\.getSession\(\)/);
  assert.match(sessionSource, /if \(!isUnexpired\(next\)\)[\s\S]*supabase\.auth\.refreshSession\(\)/);
  assert.match(sessionSource, /setAccessMode\("online"\)/);
  assert.match(sessionSource, /await applyOfflineReadiness\(\)/);
});

test("MOB-09 grant renewal follows server validation, complete cache proof, and custody", () => {
  const validationAt = renewalSource.indexOf("validatePosV2Device(");
  const readinessAt = renewalSource.indexOf("evaluateOfflineScopeReadiness(scope)");
  const custodyAt = renewalSource.indexOf("acquirePosV2ShiftCustody(");
  const grantAt = renewalSource.indexOf("saveOfflineAuthorizationGrant(scope)");
  assert.ok(validationAt >= 0 && validationAt < readinessAt);
  assert.ok(readinessAt < custodyAt && custodyAt < grantAt);
  for (const marker of [
    "STORE_ASSIGNMENT_REVOKED",
    "SHIFT_TERMINAL_MISMATCH",
    "SHIFT_FINALIZATION_IN_PROGRESS",
    "DEVICE_BINDING_CHANGED",
    "SHIFT_CUSTODY_UNAVAILABLE",
  ]) assert.ok(renewalSource.includes(marker), marker);
  for (const marker of [
    "getBusinessContextSnapshot",
    "getActiveShiftSnapshot",
    "getReferenceSnapshot",
    "getLocalCacheStates",
    "COMPLETE_CATALOG_MISSING",
  ]) assert.ok(readinessSource.includes(marker), marker);
  assert.doesNotMatch(renewalSource, /clearOfflineAuthorizationGrant|DELETE FROM|outbox_events/);
});

test("MOB-09 renewal occurs only on a safe cloud-online path", () => {
  const noRecovery = businessSource.slice(
    businessSource.indexOf("if (!needsRecovery)"),
    businessSource.indexOf("// Network is reachable"),
  );
  const recovery = businessSource.slice(
    businessSource.indexOf("const recovery ="),
    businessSource.indexOf("setMode(\"offline\")", businessSource.indexOf("const recovery =")),
  );
  assert.match(noRecovery, /renewOfflineAuthorizationFromCloud/);
  assert.match(recovery, /if \(recovery\.ok\)[\s\S]*renewOfflineAuthorizationFromCloud/);
  assert.equal((businessSource.match(/renewOfflineAuthorizationFromCloud\(next\.core\)/g) ?? []).length, 2);
  const reviewPath = businessSource.slice(businessSource.indexOf("recovery.mode"));
  assert.doesNotMatch(reviewPath, /renewOfflineAuthorizationFromCloud/);
});

test("MOB-09 enrollment immediately enters the existing automatic preparation lifecycle", () => {
  const enrollmentStart = deviceSetupSource.indexOf("const enroll = async () =>");
  const persistAt = deviceSetupSource.indexOf("await saveMobileDeviceIdentity(next)", enrollmentStart);
  const notifyAt = deviceSetupSource.indexOf("await onEnrolled?.()", enrollmentStart);

  assert.ok(enrollmentStart >= 0);
  assert.ok(persistAt > enrollmentStart, "device identity must be durable before notification");
  assert.ok(notifyAt > persistAt, "cloud lifecycle must be notified after durable enrollment");
  assert.match(homeSource, /onEnrolled=\{\(\) => reload\(core\.organization\.id\)\}/);

  assert.equal(policy.shouldRecoverCloudEntry({
    previousMode: "CLOUD_ONLINE",
    unresolvedTransactions: 0,
    terminalEnrolled: true,
    syncCursorInitialized: false,
  }), true);
});
