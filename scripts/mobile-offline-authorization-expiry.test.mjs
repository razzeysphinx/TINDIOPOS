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

const policy = await loadTypeScriptModule("apps/mobile/src/features/offline/offline-authorization-policy.ts");
const readiness = await loadTypeScriptModule("apps/mobile/src/features/offline/cashier-readiness-policy.ts");
const tolerance = 5 * 60 * 1_000;
const at = (hours) => Date.parse("2026-01-01T00:00:00.000Z") + hours * 60 * 60 * 1_000;
const window = {
  issuedAt: new Date(at(0)).toISOString(),
  expiresAt: new Date(at(12)).toISOString(),
  lastValidatedAt: new Date(at(0)).toISOString(),
};

test("MOB-09 a fixed authorization window denies work at exact expiry", () => {
  assert.deepEqual(policy.evaluateOfflineAuthorizationWindow(window, at(12), tolerance), {
    ok: false,
    reason: "EXPIRED",
    nextLastValidatedAt: new Date(at(12)).toISOString(),
  });
});

test("MOB-09 a later clock watermark prevents silently regaining elapsed time", () => {
  const advanced = policy.evaluateOfflineAuthorizationWindow(window, at(8), tolerance);
  assert.equal(advanced.ok, true);
  const observed = { ...window, lastValidatedAt: advanced.nextLastValidatedAt };
  assert.deepEqual(policy.evaluateOfflineAuthorizationWindow(observed, at(3), tolerance), {
    ok: false,
    reason: "CLOCK_ROLLBACK",
    nextLastValidatedAt: null,
  });
});

test("MOB-09 tolerance never moves the watermark backward", () => {
  const observed = { ...window, lastValidatedAt: new Date(at(8)).toISOString() };
  const decision = policy.evaluateOfflineAuthorizationWindow(observed, at(8) - tolerance + 1, tolerance);
  assert.equal(decision.ok, true);
  assert.equal(decision.nextLastValidatedAt, null);
});

test("MOB-09 forward expiry is sticky against a later clock rollback", () => {
  const expired = policy.evaluateOfflineAuthorizationWindow(window, at(20), tolerance);
  assert.equal(expired.ok, false);
  assert.equal(expired.reason, "EXPIRED");
  const observed = { ...window, lastValidatedAt: expired.nextLastValidatedAt };
  assert.equal(policy.evaluateOfflineAuthorizationWindow(observed, at(10), tolerance).reason, "CLOCK_ROLLBACK");
});

test("MOB-09 timezone offsets represent the same absolute authorization instant", () => {
  const offsetWindow = {
    ...window,
    issuedAt: "2026-01-01T08:00:00.000+08:00",
    expiresAt: "2026-01-01T20:00:00.000+08:00",
    lastValidatedAt: "2026-01-01T08:00:00.000+08:00",
  };
  assert.equal(policy.evaluateOfflineAuthorizationWindow(offsetWindow, at(6), tolerance).ok, true);
  assert.equal(policy.evaluateOfflineAuthorizationWindow(offsetWindow, at(12), tolerance).reason, "EXPIRED");
});

test("MOB-09 expiry handling preserves transaction custody and exposes recovery guidance", () => {
  const authorization = read("apps/mobile/src/features/offline/offline-authorization.ts");
  const acceptance = read("apps/mobile/src/features/outbox/create-offline-sale.ts");
  const session = read("apps/mobile/src/features/session/session-provider.tsx");
  const signIn = read("apps/mobile/app/sign-in.tsx");
  assert.match(authorization, /version: 2/);
  assert.match(authorization, /value\.version === 1/);
  assert.match(authorization, /authorizationOperationQueue/);
  assert.match(authorization, /enqueueAuthorizationOperation/);
  assert.doesNotMatch(authorization, /outbox_events|local_receipts|DELETE FROM/);
  assert.ok(acceptance.indexOf("validateOfflineAuthorizationGrant()") < acceptance.indexOf("Crypto.randomUUID()"));
  assert.ok(acceptance.indexOf("validateOfflineAuthorizationGrant()") < acceptance.lastIndexOf("enqueueSaleCompletedEvent"));
  assert.match(session, /offlineRestrictionReason/);
  assert.match(signIn, /offlineRestrictionReason/);
  assert.match(authorization, /Accepted sales remain saved/);
  assert.match(acceptance, /offlineAuthorizationFailureMessage/);
});

test("A07/A09 cashier receives a proactive warning while offline acceptance remains authorized", () => {
  const expiresAt = new Date(at(12)).toISOString();
  assert.equal(readiness.evaluateOfflineAuthorizationLifecycle({
    prepared: true,
    expiresAt,
    restrictionReason: null,
    now: at(10) + 59 * 60 * 1_000,
  }), "READY");
  const warning = readiness.evaluateOfflineAuthorizationLifecycle({
    prepared: true,
    expiresAt,
    restrictionReason: null,
    now: at(11),
  });
  assert.equal(warning, "EXPIRING_SOON");
  assert.equal(readiness.canAcceptOfflineSale(
    readiness.deriveCashierReadinessState({
      connectionMode: "DEVICE_ISOLATED",
      authorizationState: warning,
    }),
  ), true);
  assert.equal(readiness.cashierReadinessLabel("EXPIRING_SOON"), "EXPIRING SOON");
});

test("A09 automatic restriction applies at exact expiry without a checkout attempt", () => {
  const expiresAt = new Date(at(12)).toISOString();
  const expired = readiness.evaluateOfflineAuthorizationLifecycle({
    prepared: true,
    expiresAt,
    restrictionReason: null,
    now: at(12),
  });
  assert.equal(expired, "EXPIRED_RECONNECT_REQUIRED");
  assert.equal(readiness.canAcceptOfflineSale(expired), false);
  assert.equal(readiness.cashierReadinessLabel(expired), "EXPIRED / RECONNECT REQUIRED");
  assert.equal(readiness.nextOfflineAuthorizationCheckDelay({
    state: "EXPIRING_SOON",
    expiresAt,
    now: at(12) - 1,
  }), 1);

  const business = read("apps/mobile/src/features/business/business-context-provider.tsx");
  assert.match(business, /nextOfflineAuthorizationCheckDelay/);
  assert.match(business, /setTimeout\(\(\) => \{[\s\S]*setReadinessCheckedAt\(\(previous\) => Math\.max\(previous, Date\.now\(\)\)\)[\s\S]*refreshOfflineAccess/);
  assert.doesNotMatch(business, /saveOfflineAuthorizationGrant/);
});

test("A09 expiry before tender preserves the cart and final acceptance still closes the timer race", () => {
  const pos = read("apps/mobile/app/(app)/pos.tsx");
  const acceptance = read("apps/mobile/src/features/outbox/create-offline-sale.ts");
  const guardAt = pos.indexOf("if (!offlineSaleReady)");
  const submitAt = pos.indexOf("await createOfflineCashSale", guardAt);
  const clearAt = pos.indexOf("clearSaleState()", guardAt);
  assert.ok(guardAt >= 0 && submitAt > guardAt);
  assert.ok(clearAt > submitAt, "cart may clear only after durable acceptance succeeds");
  assert.doesNotMatch(pos.slice(guardAt, submitAt), /setCart\(\[\]\)|setCashTender\(""\)|clearSaleState/);
  assert.match(pos, /\|\| !offlineSaleReady/);
  assert.ok(
    acceptance.indexOf("validateOfflineAuthorizationGrant()")
      < acceptance.indexOf("Crypto.randomUUID()"),
    "final acceptance must validate authorization before allocating transaction identity",
  );
});

test("A09 background before expiry and foreground after expiry enters restricted custody immediately", () => {
  const expiresAt = new Date(at(12)).toISOString();
  assert.equal(readiness.evaluateOfflineAuthorizationLifecycle({
    prepared: true,
    expiresAt,
    restrictionReason: null,
    now: at(11.5),
  }), "EXPIRING_SOON");
  assert.equal(readiness.evaluateOfflineAuthorizationLifecycle({
    prepared: true,
    expiresAt,
    restrictionReason: null,
    now: at(12.5),
  }), "EXPIRED_RECONNECT_REQUIRED");

  const session = read("apps/mobile/src/features/session/session-provider.tsx");
  assert.match(session, /if \(state === "active"\)[\s\S]*recoverSessionOnForeground\(\)/);
  assert.match(session, /recoverSessionOnForeground[\s\S]*applyOfflineReadiness\(\)/);
  assert.match(session, /if \(grant && restricted\?\.ok\)[\s\S]*setAccessMode\("offline"\)[\s\S]*setOfflineAuthorizationState\("EXPIRED_RECONNECT_REQUIRED"\)/);
});

test("A08 incomplete preparation never reports READY and every cashier state is explicit", () => {
  assert.equal(readiness.evaluateOfflineAuthorizationLifecycle({
    prepared: false,
    expiresAt: new Date(at(12)).toISOString(),
    restrictionReason: null,
    now: at(1),
  }), "PREPARATION_REQUIRED");
  assert.equal(readiness.evaluateOfflineAuthorizationLifecycle({
    prepared: true,
    expiresAt: null,
    restrictionReason: null,
    now: at(1),
  }), "PREPARATION_REQUIRED");
  assert.equal(readiness.deriveCashierReadinessState({
    connectionMode: "RECOVERING",
    authorizationState: "READY",
  }), "RECOVERING");
  assert.equal(readiness.deriveCashierReadinessState({
    connectionMode: "SYNC_REVIEW",
    authorizationState: "READY",
  }), "SYNC_REVIEW");
  assert.deepEqual([
    "READY_OFFLINE",
    "EXPIRING_SOON",
    "EXPIRED_RECONNECT_REQUIRED",
    "PREPARATION_REQUIRED",
    "RECOVERING",
    "SYNC_REVIEW",
  ].map(readiness.cashierReadinessLabel), [
    "READY OFFLINE",
    "EXPIRING SOON",
    "EXPIRED / RECONNECT REQUIRED",
    "PREPARATION REQUIRED",
    "RECOVERING",
    "SYNC REVIEW",
  ]);
});

test("A09 accepted and pending financial custody remains accessible after expiry", () => {
  const session = read("apps/mobile/src/features/session/session-provider.tsx");
  const business = read("apps/mobile/src/features/business/business-context-provider.tsx");
  const layout = read("apps/mobile/app/(app)/_layout.tsx");
  const home = read("apps/mobile/app/(app)/index.tsx");
  const navigation = read(
    "apps/mobile/src/features/cashier/cashier-navigation.ts",
  );
  const signIn = read("apps/mobile/app/sign-in.tsx");
  const custody = read("apps/mobile/src/features/offline/transaction-custody.ts");
  const schema = read("apps/mobile/src/db/schema.ts");
  assert.match(business, /evaluateRestrictedOfflineReadiness/);
  assert.match(business, /setData\(cachedBootstrap\(restrictedCore\)\)/);
  assert.match(layout, /accessMode !== "online"[\s\S]*accessMode !== "offline"/);
  assert.match(navigation, /"\/receipts"/);
  assert.match(navigation, /"\/sync-status"/);
  assert.match(home, /buildCashierNavigation/);
  assert.match(signIn, /cashierReadinessLabel\(readinessState\)/);
  assert.match(custody, /outbox_events/);
  assert.match(custody, /checkout_intents/);
  assert.match(schema, /outbox_recovery_actions/);
  const expiryPath = session.slice(
    session.indexOf("if (grant && restricted?.ok)"),
    session.indexOf("setAccessMode(\"signed-out\")", session.indexOf("if (grant && restricted?.ok)")),
  );
  assert.doesNotMatch(expiryPath, /signOut|clearOfflineAuthorizationGrant|DELETE FROM|setData\(null\)/);
});

test("A07/A08 validated cloud context alone may restore offline readiness", () => {
  const renewal = read("apps/mobile/src/features/offline/renew-offline-authorization.ts");
  const business = read("apps/mobile/src/features/business/business-context-provider.tsx");
  const validateAt = renewal.indexOf("validatePosV2Device(");
  const readinessAt = renewal.indexOf("evaluateOfflineScopeReadiness(scope)");
  const custodyAt = renewal.indexOf("acquirePosV2ShiftCustody(");
  const grantAt = renewal.indexOf("saveOfflineAuthorizationGrant(scope)");
  assert.ok(validateAt >= 0 && validateAt < readinessAt && readinessAt < custodyAt && custodyAt < grantAt);
  for (const denial of [
    "STORE_ASSIGNMENT_REVOKED",
    "DEVICE_REJECTED",
    "DEVICE_BINDING_CHANGED",
    "SHIFT_TERMINAL_MISMATCH",
    "SHIFT_CUSTODY_UNAVAILABLE",
  ]) assert.match(renewal, new RegExp(denial));
  assert.match(business, /setPreparedOfflineExpiresAt\(renewal\.ok \? renewal\.expiresAt : null\)/);
});

test("A10 monitoring detects clock changes without locally renewing authorization", () => {
  const expiresAt = new Date(at(12)).toISOString();
  assert.equal(readiness.evaluateOfflineAuthorizationLifecycle({
    prepared: true,
    expiresAt,
    restrictionReason: "CLOCK_ROLLBACK",
    now: at(3),
  }), "EXPIRED_RECONNECT_REQUIRED");
  assert.equal(readiness.evaluateOfflineAuthorizationLifecycle({
    prepared: true,
    expiresAt,
    restrictionReason: null,
    now: at(20),
  }), "EXPIRED_RECONNECT_REQUIRED");
  assert.ok(readiness.nextOfflineAuthorizationCheckDelay({
    state: "READY",
    expiresAt,
    now: at(1),
  }) <= readiness.OFFLINE_AUTHORIZATION_MONITOR_INTERVAL_MS);

  const cashierPolicy = read("apps/mobile/src/features/offline/cashier-readiness-policy.ts");
  const business = read("apps/mobile/src/features/business/business-context-provider.tsx");
  assert.doesNotMatch(cashierPolicy, /saveOfflineAuthorizationGrant|OFFLINE_AUTHORIZATION_WINDOW_MS|issuedAt/);
  assert.doesNotMatch(business, /saveOfflineAuthorizationGrant/);
  assert.doesNotMatch(business, /setReadinessCheckedAt\(Date\.now\(\)\)/);
});
