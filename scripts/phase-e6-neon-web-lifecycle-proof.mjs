import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";

import { chromium } from "@playwright/test";

const baseUrl = process.env.NEON_AUTH_BASE_URL?.trim();
const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET?.trim();
const projectId = process.env.TINDIO_E6_NEON_PROJECT_ID?.trim();
const branchId = process.env.TINDIO_E6_NEON_BRANCH_ID?.trim();
const databaseName = process.env.TINDIO_E6_NEON_DATABASE_NAME?.trim();
const roleName = process.env.TINDIO_E6_NEON_ROLE_NAME?.trim();
const host = "localhost";
const port = Number(process.env.TINDIO_E6_PROOF_PORT ?? "3106");
const appUrl = `http://${host}:${port}`;
const repositoryRoot = new URL("..", import.meta.url);

assert.equal(process.env.TINDIO_AUTH_PROVIDER, "neon");
assert.equal(process.env.TINDIO_AUTH_PROOF_MODE, "local");
assert.ok(baseUrl, "NEON_AUTH_BASE_URL is required");
assert.ok(cookieSecret && cookieSecret.length >= 32, "NEON_AUTH_COOKIE_SECRET must contain at least 32 characters");
assert.match(projectId ?? "", /^[a-z0-9-]+$/i, "a safe E6 Neon project ID is required");
assert.match(branchId ?? "", /^[a-z0-9-]+$/i, "a safe E6 Neon branch ID is required");
assert.match(databaseName ?? "", /^[a-z_][a-z0-9_]*$/i, "a safe E6 database name is required");
assert.match(roleName ?? "", /^[a-z_][a-z0-9_]*$/i, "a safe E6 role name is required");
assert.equal(process.env.VERCEL, undefined, "E6 proof cannot run in a Vercel deployment");
assert.equal(process.env.VERCEL_ENV, undefined, "E6 proof cannot run in a Vercel deployment");

const authUrl = new URL(baseUrl);
assert.equal(authUrl.protocol, "https:");
assert.match(authUrl.hostname, /^[a-z0-9-]+\.neonauth(?:\.[a-z0-9-]+)*\.neon\.tech$/i);
assert.ok(authUrl.pathname.endsWith("/auth"));

const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const email = `phase-e6-${runId}@auth-proof.tindio.invalid`;
const oldPassword = `E6!aA9-${randomBytes(18).toString("base64url")}`;
const newPassword = `E6!bB8-${randomBytes(18).toString("base64url")}`;
const serverOutput = [];

function runCommand(command, args, { quietStderr = false } = {}) {
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
      if (code === 0) return resolve(stdout.trim());
      reject(new Error(`${command} exited with ${code}.${quietStderr ? "" : `\n${stderr}`}`));
    });
  });
}

function runNeon(args, options) {
  if (process.platform !== "win32") return runCommand("neon", args, options);
  const appData = process.env.APPDATA;
  assert.ok(appData, "APPDATA is required to resolve the Neon CLI on Windows");
  return runCommand(
    process.execPath,
    [join(appData, "npm", "node_modules", "neon", "dist", "cli.js"), ...args],
    options,
  );
}

function neonArgs(args) {
  return [
    ...args,
    "--project-id", projectId,
  ];
}

async function getEmailPasswordConfiguration() {
  const output = await runNeon(neonArgs([
    "neon-auth", "config", "email-password", "get",
    "--branch", branchId,
    "--output", "json",
  ]));
  return JSON.parse(output);
}

async function setEmailPasswordConfiguration(configuration) {
  await runNeon(neonArgs([
    "neon-auth", "config", "email-password", "update",
    "--branch", branchId,
    "--enabled", String(configuration.enabled),
    "--email-verification-method", configuration.email_verification_method,
    "--require-email-verification", String(configuration.require_email_verification),
    "--auto-sign-in-after-verification", String(configuration.auto_sign_in_after_verification),
    "--send-verification-email-on-sign-up", String(configuration.send_verification_email_on_sign_up),
    "--send-verification-email-on-sign-in", String(configuration.send_verification_email_on_sign_in),
    "--disable-sign-up", String(configuration.disable_sign_up),
    "--output", "json",
  ]));
}

async function queryScalar(sql) {
  return runNeon([
    "psql", branchId,
    "--project-id", projectId,
    "--database-name", databaseName,
    "--role-name", roleName,
    "--", "-X", "-t", "-A", "-c", sql,
  ], { quietStderr: true });
}

async function waitForScalar(sql, description) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = (await queryScalar(sql)).trim();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function recoverSyntheticSixDigitOtp(storedValue) {
  const storedHash = storedValue.split(":", 1)[0];
  assert.match(storedHash, /^[A-Za-z0-9_-]{43}$/);
  for (let candidate = 0; candidate <= 999_999; candidate += 1) {
    const otp = String(candidate).padStart(6, "0");
    const candidateHash = createHash("sha256").update(otp).digest("base64url");
    if (candidateHash === storedHash) return otp;
  }
  throw new Error("The synthetic verification challenge did not contain a recoverable six-digit OTP.");
}

const originalConfiguration = await getEmailPasswordConfiguration();
const proofConfiguration = {
  enabled: true,
  email_verification_method: "otp",
  require_email_verification: true,
  auto_sign_in_after_verification: true,
  send_verification_email_on_sign_up: true,
  send_verification_email_on_sign_in: false,
  disable_sign_up: false,
};

let configurationChanged = false;
let server;
let browser;
let proofFailure;
let restored = false;

try {
  await setEmailPasswordConfiguration(proofConfiguration);
  configurationChanged = true;

  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "--hostname", host, "--port", String(port)],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        NODE_ENV: "development",
        TINDIO_AUTH_PROOF_ORIGIN: appUrl,
        TINDIO_AUTH_PROOF_SESSION_DATA_TTL: "30",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  for (const stream of [server.stdout, server.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      serverOutput.push(chunk);
      if (serverOutput.length > 80) serverOutput.shift();
    });
  }

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Next.js proof server exited early.\n${serverOutput.join("")}`);
    try {
      const response = await fetch(`${appUrl}/auth-proof`, { redirect: "manual" });
      if (response.status < 500) break;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${appUrl}/auth-proof`);
  await page.getByText("Local synthetic proof only").waitFor();

  await page.getByLabel("Synthetic name").fill("TINDIO Phase E6 Synthetic User");
  await page.locator("#proof-signup-email").fill(email);
  await page.locator("#proof-signup-password").fill(oldPassword);
  await page.locator("#proof-confirm-password").fill(oldPassword);
  await page.getByRole("button", { name: "Create proof account" }).click();
  await page.waitForURL(/event=verification-required/);
  const preVerificationStatus = page.getByTestId("proof-email-verification-status");
  if (await preVerificationStatus.count()) {
    assert.equal(await preVerificationStatus.textContent(), "Email not verified");
  } else {
    assert.equal(await page.getByTestId("proof-session-status").count(), 0);
  }

  await page.getByLabel("Verification request email").fill(email);
  await page.getByRole("button", { name: "Request verification code" }).click();
  await page.waitForURL(/event=verification-requested/);

  const otpValue = await waitForScalar(
    `select value from neon_auth.verification where identifier = 'email-verification-otp-${email}' and "expiresAt" > now() order by "createdAt" desc limit 1`,
    "the branch-local verification challenge",
  );
  const otp = recoverSyntheticSixDigitOtp(otpValue);

  await page.getByLabel("Verification email").fill(email);
  await page.getByLabel("Verification code").fill(otp);
  await page.getByRole("button", { name: "Verify proof email" }).click();
  await page.waitForURL(/event=email-verified/);
  await page.getByTestId("proof-session-status").waitFor();
  assert.equal(await page.getByTestId("proof-email-verification-status").textContent(), "Email verified");

  const sessionResponse = await page.request.get(`${appUrl}/api/auth-proof/session`);
  const sessionPayload = await sessionResponse.json();
  assert.equal(sessionPayload.user.email, email);
  assert.equal(sessionPayload.user.emailVerified, true);
  const userId = sessionPayload.user.id;
  assert.match(userId, /^[0-9a-f-]{36}$/i);

  await page.getByRole("button", { name: "Sign out proof session" }).click();
  await page.waitForURL(/event=signed-out/);
  await page.locator("#proof-signin-email").fill(email);
  await page.locator("#proof-signin-password").fill(oldPassword);
  await page.getByRole("button", { name: "Sign in for proof" }).click();
  await page.waitForURL(/(?:event=signed-in|error=)/);
  assert.match(page.url(), /event=signed-in/, "verified password sign-in must succeed");
  await page.getByTestId("proof-session-status").waitFor();

  const authenticatedCookies = await context.cookies(appUrl);
  const sessionTokenCookie = authenticatedCookies.find((cookie) => cookie.name.endsWith(".session_token"));
  const sessionDataCookie = authenticatedCookies.find((cookie) => cookie.name.endsWith(".session_data"));
  assert.ok(sessionTokenCookie?.httpOnly, "the primary session token must be HTTP-only");
  assert.ok(
    sessionDataCookie?.httpOnly,
    `the session cache must be HTTP-only; observed cookie names: ${authenticatedCookies.map(({ name }) => name).join(", ")}`,
  );
  const originalSessionToken = sessionTokenCookie.value;

  await context.clearCookies({ name: sessionDataCookie.name });
  assert.equal((await context.cookies(appUrl)).some((cookie) => cookie.name.endsWith(".session_data")), false);
  await page.goto(`${appUrl}/auth-proof`);
  await page.getByTestId("proof-session-status").waitFor();
  const refreshedCookies = await context.cookies(appUrl);
  assert.equal(refreshedCookies.find((cookie) => cookie.name.endsWith(".session_token"))?.value, originalSessionToken);
  assert.ok(refreshedCookies.some((cookie) => cookie.name.endsWith(".session_data")), "session cache must be reminted");

  await page.getByRole("button", { name: "Sign out proof session" }).click();
  await page.waitForURL(/event=signed-out/);
  await page.getByLabel("Recovery email").fill(email);
  await page.getByRole("button", { name: "Request proof recovery" }).click();
  await page.waitForURL(/event=recovery-requested/);

  const recoveryToken = await waitForScalar(
    `select substring(identifier from length('reset-password:') + 1) from neon_auth.verification where identifier like 'reset-password:%' and value = '${userId}' and "expiresAt" > now() order by "createdAt" desc limit 1`,
    "the branch-local recovery challenge",
  );
  assert.match(recoveryToken, /^[A-Za-z0-9_-]+$/);

  await page.locator("#proof-recovery-token").fill(recoveryToken);
  await page.locator("#proof-new-password").fill(newPassword);
  await page.locator("#proof-new-password-confirmation").fill(newPassword);
  await page.getByRole("button", { name: "Reset proof password" }).click();
  await page.waitForURL(/event=password-reset/);

  await page.locator("#proof-signin-email").fill(email);
  await page.locator("#proof-signin-password").fill(oldPassword);
  await page.getByRole("button", { name: "Sign in for proof" }).click();
  await page.waitForURL(/error=Email/);

  await page.locator("#proof-signin-email").fill(email);
  await page.locator("#proof-signin-password").fill(newPassword);
  await page.getByRole("button", { name: "Sign in for proof" }).click();
  await page.waitForURL(/event=signed-in/);
  await page.getByTestId("proof-session-status").waitFor();
  await page.getByRole("button", { name: "Sign out proof session" }).click();
  await page.waitForURL(/event=signed-out/);
} catch (error) {
  proofFailure = error;
} finally {
  await browser?.close();
  if (server?.exitCode === null) server.kill();
  if (configurationChanged) {
    await setEmailPasswordConfiguration(originalConfiguration);
    const restoredConfiguration = await getEmailPasswordConfiguration();
    restored = JSON.stringify(restoredConfiguration) === JSON.stringify(originalConfiguration);
  }
}

if (proofFailure) throw proofFailure;
assert.equal(restored, true, "the original branch auth configuration must be restored");

process.stdout.write(`${JSON.stringify({
  status: "PASS",
  runId,
  syntheticEmail: email,
  evidence: {
    signupRequiredVerification: true,
    branchLocalVerificationChallengeObserved: true,
    emailVerificationAccepted: true,
    verifiedSessionEstablished: true,
    localhostRecoveryRedirectConfigured: true,
    httpOnlySessionCookiesObserved: true,
    sessionDataCookieRemoved: true,
    sessionTokenPreserved: true,
    sessionDataCookieRefreshed: true,
    sessionSurvivedForcedRefresh: true,
    passwordResetRequested: true,
    branchLocalRecoveryChallengeObserved: true,
    passwordResetAccepted: true,
    oldPasswordDenied: true,
    newPasswordAccepted: true,
    sessionSignedOut: true,
    originalAuthConfigurationRestored: restored,
  },
  promotedFlows: ["E-AUTH-02", "E-AUTH-04", "E-AUTH-07"],
  intentionallyNotClaimed: ["E-AUTH-05", "E-AUTH-08", "E-AUTH-09", "E-AUTH-10", "E-AUTH-11", "E-AUTH-12", "E-AUTH-13"],
}, null, 2)}\n`);
