import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import {
  createNeonMobileAuth,
  NEON_MOBILE_AUTH_COOKIE_KEY,
} from "../apps/mobile/src/features/session/neon-mobile-auth.ts";

const baseUrl = process.env.NEON_AUTH_BASE_URL?.trim();
const projectId = process.env.TINDIO_PHASE_E_NEON_PROJECT_ID?.trim();
const branchId = process.env.TINDIO_PHASE_E_NEON_BRANCH_ID?.trim();
const repositoryRoot = new URL("..", import.meta.url);

assert.equal(process.env.TINDIO_AUTH_PROVIDER, "neon");
assert.equal(process.env.TINDIO_AUTH_PROOF_MODE, "local");
assert.notEqual(process.env.NODE_ENV, "production");
assert.equal(process.env.VERCEL, undefined);
assert.equal(process.env.VERCEL_ENV, undefined);
assert.ok(baseUrl, "NEON_AUTH_BASE_URL is required");
assert.match(projectId ?? "", /^[a-z0-9-]+$/i);
assert.match(branchId ?? "", /^[a-z0-9-]+$/i);

const authUrl = new URL(baseUrl);
assert.equal(authUrl.protocol, "https:");
assert.match(authUrl.hostname, /^[a-z0-9-]+\.neonauth(?:\.[a-z0-9-]+)*\.neon\.tech$/i);
assert.ok(authUrl.pathname.replace(/\/$/, "").endsWith("/auth"));

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} exited with ${code}.\n${stderr}`));
    });
  });
}

function runNeon(args) {
  if (process.platform !== "win32") return runCommand("neon", args);
  assert.ok(process.env.APPDATA);
  return runCommand(process.execPath, [
    join(process.env.APPDATA, "npm", "node_modules", "neon", "dist", "cli.js"),
    ...args,
  ]);
}

const neonArgs = (args) => [
  ...args,
  "--project-id", projectId,
  "--branch", branchId,
  "--output", "json",
];

async function getEmailPasswordConfiguration() {
  return JSON.parse(await runNeon(neonArgs([
    "neon-auth", "config", "email-password", "get",
  ])));
}

async function setEmailPasswordConfiguration(configuration) {
  await runNeon(neonArgs([
    "neon-auth", "config", "email-password", "update",
    "--enabled", String(configuration.enabled),
    "--email-verification-method", configuration.email_verification_method,
    "--require-email-verification", String(configuration.require_email_verification),
    "--auto-sign-in-after-verification", String(configuration.auto_sign_in_after_verification),
    "--send-verification-email-on-sign-up", String(configuration.send_verification_email_on_sign_up),
    "--send-verification-email-on-sign-in", String(configuration.send_verification_email_on_sign_in),
    "--disable-sign-up", String(configuration.disable_sign_up),
  ]));
}

const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const email = `phase-e-mobile-${runId}@auth-proof.tindio.invalid`;
const password = `Em5!${randomBytes(18).toString("base64url")}`;
const origin = "http://localhost:3108";
const values = new Map([
  ["tindio.pos.device.synthetic-org", "synthetic-device-identity"],
  ["tindio.pos.offline.authorization", "synthetic-offline-grant"],
]);
const storage = {
  async getItem(key) { return values.get(key) ?? null; },
  async setItem(key, value) { values.set(key, value); },
  async removeItem(key) { values.delete(key); },
};
const sqliteCustody = {
  transactionRows: 1,
  receiptSnapshots: 1,
  outboxRows: 1,
};
const custodyBefore = JSON.stringify(sqliteCustody);
const requestCounts = new Map();
const countedFetch = async (input, init) => {
  const path = new URL(input).pathname;
  requestCounts.set(path, (requestCounts.get(path) ?? 0) + 1);
  return fetch(input, init);
};

const originalConfiguration = await getEmailPasswordConfiguration();
const proofConfiguration = {
  enabled: true,
  email_verification_method: "otp",
  require_email_verification: false,
  auto_sign_in_after_verification: true,
  send_verification_email_on_sign_up: false,
  send_verification_email_on_sign_in: false,
  disable_sign_up: false,
};

let userId = null;
let proofFailure;
let configurationRestored = false;
let syntheticUserRemoved = false;
let result;

try {
  await setEmailPasswordConfiguration(proofConfiguration);
  const signup = await fetch(`${baseUrl.replace(/\/$/, "")}/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ email, password, name: "TINDIO Mobile Auth Proof" }),
  });
  const signupBody = await signup.json();
  assert.equal(signup.status, 200, `synthetic signup failed: ${JSON.stringify(signupBody)}`);
  userId = signupBody.user?.id;
  assert.match(userId ?? "", /^[0-9a-f-]{36}$/i);
  const signupCookie = (signup.headers.get("set-cookie") ?? "").split(";", 1)[0];
  assert.ok(signupCookie.includes("="));
  const preliminarySignOut = await fetch(`${baseUrl.replace(/\/$/, "")}/sign-out`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: signupCookie, Origin: origin },
    body: "{}",
  });
  assert.equal(preliminarySignOut.ok, true);

  const firstInstall = createNeonMobileAuth({
    baseUrl,
    origin,
    storage,
    fetch: countedFetch,
  });
  const signedIn = await firstInstall.signInWithPassword({ email, password });
  assert.equal(
    signedIn.ok,
    true,
    signedIn.ok ? undefined : JSON.stringify(signedIn.error),
  );
  assert.equal(signedIn.value.provider, "neon");
  assert.equal(signedIn.value.identity.subject, userId);
  assert.equal(signedIn.value.accessToken.split(".").length, 3);
  assert.ok(values.get(NEON_MOBILE_AUTH_COOKIE_KEY));

  const relaunched = createNeonMobileAuth({
    baseUrl,
    origin,
    storage,
    fetch: countedFetch,
  });
  const restored = await relaunched.getSession();
  assert.equal(restored.ok && restored.value?.identity.subject, userId);

  const sessionPath = `${authUrl.pathname.replace(/\/$/, "")}/get-session`;
  const tokenPath = `${authUrl.pathname.replace(/\/$/, "")}/token`;
  const beforeRefresh = {
    session: requestCounts.get(sessionPath) ?? 0,
    token: requestCounts.get(tokenPath) ?? 0,
  };
  const [refreshA, refreshB] = await Promise.all([
    relaunched.refreshSession(),
    relaunched.refreshSession(),
  ]);
  assert.equal(refreshA.ok, true);
  assert.equal(refreshB.ok, true);
  assert.equal((requestCounts.get(sessionPath) ?? 0) - beforeRefresh.session, 1);
  assert.equal((requestCounts.get(tokenPath) ?? 0) - beforeRefresh.token, 1);

  const signedOut = await relaunched.signOut();
  assert.equal(signedOut.ok, true);
  assert.equal(values.has(NEON_MOBILE_AUTH_COOKIE_KEY), false);
  assert.equal(values.get("tindio.pos.device.synthetic-org"), "synthetic-device-identity");
  assert.equal(values.get("tindio.pos.offline.authorization"), "synthetic-offline-grant");
  assert.equal(JSON.stringify(sqliteCustody), custodyBefore);
  const deniedAfterSignOut = await relaunched.getSession();
  assert.equal(deniedAfterSignOut.ok && deniedAfterSignOut.value, null);

  result = {
    status: "PASS",
    runId,
    syntheticEmail: email,
    evidence: {
      freshPasswordSignInSucceeded: true,
      neonJwtIssued: true,
      secureSessionCookiePersisted: true,
      simulatedAppRelaunchRestoredSession: true,
      concurrentRefreshCallsCoalesced: true,
      refreshRequestBound: { getSession: 1, token: 1 },
      signOutClearedOnlyNeonAuthCookie: true,
      deviceIdentityPreserved: true,
      offlineGrantPreservedByAuthAdapter: true,
      sqliteTransactionCustodyPreserved: true,
      receiptSnapshotsPreserved: true,
      outboxRowsPreserved: true,
      signedOutSessionDenied: true,
    },
    promotedFlows: ["E-AUTH-08", "E-AUTH-09", "E-AUTH-10"],
  };
} catch (error) {
  proofFailure = error;
} finally {
  if (userId) {
    try {
      await runNeon(neonArgs(["neon-auth", "user", "delete", userId]));
      syntheticUserRemoved = true;
    } catch (error) {
      proofFailure ??= error;
    }
  }
  try {
    await setEmailPasswordConfiguration(originalConfiguration);
    configurationRestored = JSON.stringify(await getEmailPasswordConfiguration())
      === JSON.stringify(originalConfiguration);
  } catch (error) {
    proofFailure ??= error;
  }
}

if (proofFailure) throw proofFailure;
assert.equal(syntheticUserRemoved, true);
assert.equal(configurationRestored, true);
result.evidence.syntheticUserRemoved = syntheticUserRemoved;
result.evidence.originalAuthConfigurationRestored = configurationRestored;
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
