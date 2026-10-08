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
