import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

import { chromium } from "@playwright/test";

const baseUrl = process.env.NEON_AUTH_BASE_URL?.trim();
const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET?.trim();
// The E2 branch allowlists the literal localhost origin; 127.0.0.1 is
// intentionally not treated as equivalent by Managed Better Auth.
const host = "localhost";
const port = Number(process.env.TINDIO_E4_PROOF_PORT ?? "3104");
const appUrl = `http://${host}:${port}`;

assert.equal(process.env.TINDIO_AUTH_PROVIDER, "neon");
assert.equal(process.env.TINDIO_AUTH_PROOF_MODE, "local");
assert.ok(baseUrl, "NEON_AUTH_BASE_URL is required");
assert.ok(cookieSecret && cookieSecret.length >= 32, "NEON_AUTH_COOKIE_SECRET must contain at least 32 characters");
assert.equal(process.env.VERCEL, undefined, "E4 proof cannot run in a Vercel deployment");
assert.equal(process.env.VERCEL_ENV, undefined, "E4 proof cannot run in a Vercel deployment");

const authUrl = new URL(baseUrl);
assert.equal(authUrl.protocol, "https:");
assert.match(authUrl.hostname, /^[a-z0-9-]+\.neonauth(?:\.[a-z0-9-]+)*\.neon\.tech$/i);
assert.ok(authUrl.pathname.endsWith("/auth"));

const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const email = `phase-e4-${runId}@auth-proof.tindio.invalid`;
const password = `E4!aA9-${randomBytes(18).toString("base64url")}`;
const serverOutput = [];

const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "--hostname", host, "--port", String(port)],
  {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      NODE_ENV: "development",
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

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Next.js proof server exited early.\n${serverOutput.join("")}`);
    }
    try {
      const response = await fetch(`${appUrl}/auth-proof`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for the E4 proof server.\n${serverOutput.join("")}`);
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${appUrl}/auth-proof`);
  await page.getByText("Local synthetic proof only").waitFor();

  await page.getByLabel("Synthetic name").fill("TINDIO Phase E4 Synthetic User");
  await page.getByLabel("Synthetic email").first().fill(email);
  await page.getByLabel("Password").first().fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create proof account" }).click();
  await page.waitForURL(/event=signed-up/);
  await page.getByTestId("proof-session-status").waitFor();
  assert.equal(await page.getByTestId("proof-session-email").textContent(), email);

  const authenticatedCookies = await context.cookies(appUrl);
  assert.ok(authenticatedCookies.length > 0, "signup must establish a cookie session");
  assert.ok(authenticatedCookies.some((cookie) => cookie.httpOnly), "session must include an HTTP-only cookie");

  await page.reload();
  await page.getByTestId("proof-session-status").waitFor();
  assert.equal(await page.getByTestId("proof-session-email").textContent(), email);

  await page.getByRole("button", { name: "Sign out proof session" }).click();
  await page.waitForURL(/event=signed-out/);
  await page.getByRole("button", { name: "Sign in for proof" }).waitFor();

  await new Promise((resolve) => setTimeout(resolve, 1_250));
  await context.addCookies(authenticatedCookies);
  await page.goto(`${appUrl}/auth-proof`);
  const replaySignInButton = page.getByRole("button", { name: "Sign in for proof" });
  await replaySignInButton.waitFor();
  assert.equal(await page.getByTestId("proof-session-status").count(), 0, "revoked cookie replay must not restore the session");

  const signInEmail = page.getByLabel("Synthetic email").last();
  const signInPassword = page.getByLabel("Password").last();
  await signInEmail.fill(email);
  await signInPassword.fill(`${password}-invalid`);
  await page.getByRole("button", { name: "Sign in for proof" }).click();
  await page.waitForURL(/error=Email/);
  await page.getByRole("alert").filter({ hasText: "Email or password is incorrect." }).waitFor();

  await page.getByLabel("Synthetic email").last().fill(email);
  await page.getByLabel("Password").last().fill(password);
  await page.getByRole("button", { name: "Sign in for proof" }).click();
  await page.waitForURL(/event=signed-in/);
  await page.getByTestId("proof-session-status").waitFor();

  await page.getByRole("button", { name: "Sign out proof session" }).click();
  await page.waitForURL(/event=signed-out/);

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    runId,
    syntheticEmail: email,
    endpointHost: authUrl.hostname,
    evidence: {
      signupEstablishedSession: true,
      httpOnlyCookieObserved: true,
      sessionSurvivedNavigation: true,
      invalidPasswordDenied: true,
      validPasswordAccepted: true,
      signOutClearedSession: true,
      revokedCookieReplayDenied: true,
    },
    promotedFlows: ["E-AUTH-01", "E-AUTH-03", "E-AUTH-06"],
    intentionallyNotClaimed: ["E-AUTH-02", "E-AUTH-04", "E-AUTH-05", "E-AUTH-07", "E-AUTH-08", "E-AUTH-09", "E-AUTH-10", "E-AUTH-11", "E-AUTH-12", "E-AUTH-13"],
  }, null, 2)}\n`);
} finally {
  await browser?.close();
  if (server.exitCode === null) server.kill();
}
