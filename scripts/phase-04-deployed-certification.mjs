import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import process from "node:process";

import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const deploymentUrl = new URL(required("TINDIO_PHASE_04_DEPLOYMENT_URL"));
const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
const publishableKey = required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const neonDataApiUrl = required("NEON_DATA_API_URL");
const email = required("TINDIO_PHASE_04_TEST_EMAIL");
const password = required("TINDIO_PHASE_04_TEST_PASSWORD");
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || null;

const MAX_TRANSIENT_ATTEMPTS = 3;
const TRANSIENT_STATUS = new Set([429, 502, 503, 504]);

function deploymentEndpoint(pathname) {
  return new URL(pathname, deploymentUrl);
}

function neonEndpoint(relativePath) {
  const base = neonDataApiUrl.endsWith("/") ? neonDataApiUrl : `${neonDataApiUrl}/`;
  return new URL(relativePath.replace(/^\/+/, ""), base);
}

function protectedHeaders(headers) {
  const result = new Headers(headers);
  if (protectionBypass) result.set("x-vercel-protection-bypass", protectionBypass);
  return result;
}

function contentType(response) {
  return response.headers.get("content-type") ?? "";
}

function isJson(response) {
  return /application\/json/i.test(contentType(response));
}

function isTransientResponse(response) {
  return TRANSIENT_STATUS.has(response.status) || (response.status === 200 && !isJson(response));
}

async function fetchWithTransientRetry(url, init, { label, expectJson = false }) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_TRANSIENT_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        cache: "no-store",
        headers: protectedHeaders(init?.headers),
      });
      const transient = isTransientResponse(response) || (expectJson && response.status === 200 && !isJson(response));
      if (transient && attempt < MAX_TRANSIENT_ATTEMPTS) {
        console.log(`${label}: transient attempt ${attempt}/${MAX_TRANSIENT_ATTEMPTS}`);
        await response.arrayBuffer().catch(() => null);
        await sleep(750 * attempt);
        continue;
      }
      return { response, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_TRANSIENT_ATTEMPTS) throw error;
      console.log(`${label}: transport retry ${attempt}/${MAX_TRANSIENT_ATTEMPTS}`);
      await sleep(750 * attempt);
    }
  }
  throw lastError ?? new Error(`${label} failed without a response.`);
}

async function expectJsonResponse({ url, init, expectedStatus, label }) {
  const { response, attempts } = await fetchWithTransientRetry(url, init, { label, expectJson: true });
  assert.match(contentType(response), /application\/json/i, `${label} returned HTTP ${response.status} with non-JSON content-type ${contentType(response) || "<empty>"}.`);
  assert.equal(response.status, expectedStatus, `${label} expected HTTP ${expectedStatus}, received HTTP ${response.status}.`);
  return { body: await response.json(), attempts };
}

function isDeterministicBrowserFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("/onboarding")
    || message.includes("/workspace/no-access")
    || /returned HTTP (400|401|403|500)\b/.test(message);
}

async function runBrowserCookieCertification() {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_TRANSIENT_ATTEMPTS; attempt += 1) {
    const browser = await chromium.launch();
    let context;
    try {
      context = await browser.newContext({
        extraHTTPHeaders: protectionBypass
          ? {
              "x-vercel-protection-bypass": protectionBypass,
              "x-vercel-set-bypass-cookie": "true",
            }
          : {},
      });
      const page = await context.newPage();
      const loginResponse = await page.goto(deploymentEndpoint("/login").toString(), {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      assert.ok(loginResponse, "Deployed login navigation returned no response.");
      if (TRANSIENT_STATUS.has(loginResponse.status()) && attempt < MAX_TRANSIENT_ATTEMPTS) {
        throw new Error(`TRANSIENT_LOGIN_HTTP_${loginResponse.status()}`);
      }
      assert.ok(loginResponse.ok(), `Deployed browser login page returned HTTP ${loginResponse.status()}.`);
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
      const signedInUrl = new URL(page.url());
      assert.ok(!signedInUrl.pathname.startsWith("/onboarding"), "The Phase 04 certification account was redirected to onboarding.");
      assert.ok(!signedInUrl.pathname.startsWith("/workspace/no-access"), "The Phase 04 Owner certification account was redirected to /workspace/no-access.");
      console.log(`Deployed browser login: PASS (attempt ${attempt})`);

      let cookieBootstrapResponse = null;
      for (let cookieAttempt = 1; cookieAttempt <= MAX_TRANSIENT_ATTEMPTS; cookieAttempt += 1) {
        const response = await context.request.get(deploymentEndpoint("/api/pos/v1/bootstrap").toString(), {
          headers: {
            Accept: "application/json",
            ...(protectionBypass ? { "x-vercel-protection-bypass": protectionBypass } : {}),
          },
        });
        const responseContentType = response.headers()["content-type"] ?? "";
        const transient = TRANSIENT_STATUS.has(response.status()) || (response.status() === 200 && !/application\/json/i.test(responseContentType));
        if (transient && cookieAttempt < MAX_TRANSIENT_ATTEMPTS) {
          console.log(`Cookie POS bootstrap: transient attempt ${cookieAttempt}/${MAX_TRANSIENT_ATTEMPTS}`);
          await sleep(750 * cookieAttempt);
          continue;
        }
        cookieBootstrapResponse = response;
        break;
      }
      assert.ok(cookieBootstrapResponse, "Cookie POS bootstrap produced no response.");
      const cookieContentType = cookieBootstrapResponse.headers()["content-type"] ?? "";
      assert.match(cookieContentType, /application\/json/i, `Deployed cookie POS bootstrap returned HTTP ${cookieBootstrapResponse.status()} with non-JSON content-type ${cookieContentType || "<empty>"}.`);
      assert.equal(cookieBootstrapResponse.status(), 200, `Deployed cookie POS bootstrap returned HTTP ${cookieBootstrapResponse.status()}.`);
      const cookieBootstrapBody = await cookieBootstrapResponse.json();
      assert.equal(typeof cookieBootstrapBody?.organization?.id, "string", "Deployed cookie POS bootstrap did not return an organization.");
      assert.equal(typeof cookieBootstrapBody?.employee?.id, "string", "Deployed cookie POS bootstrap did not return an employee.");
      console.log("Deployed cookie workspace authorization: PASS");
      console.log("Deployed cookie POS bootstrap: PASS");
      return { pathname: signedInUrl.pathname, attempts: attempt };
    } catch (error) {
      if (isDeterministicBrowserFailure(error) || attempt >= MAX_TRANSIENT_ATTEMPTS) throw error;
      lastError = error;
      console.log(`Browser certification: transient retry ${attempt}/${MAX_TRANSIENT_ATTEMPTS}`);
      await sleep(1_000 * attempt);
    } finally {
      await context?.close().catch(() => null);
      await browser.close().catch(() => null);
    }
  }
  throw lastError ?? new Error("Browser certification failed without a deterministic error.");
}

const browserResult = await runBrowserCookieCertification();
const auth = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await auth.auth.signInWithPassword({ email, password });
assert.equal(error, null, `Hosted Supabase bearer sign-in failed: ${error?.message ?? "unknown error"}`);
assert.ok(data.session, "Hosted Supabase did not return a bearer certification session.");
const token = data.session.access_token;

const { body: directProfileId, attempts: neonIdentityAttempts } = await expectJsonResponse({
  url: neonEndpoint("rpc/current_profile_id"),
  init: { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" }, body: "{}" },
  expectedStatus: 200,
  label: "Direct Neon current_profile_id",
});
assert.ok(typeof directProfileId === "string" && directProfileId.length > 0, "Neon did not resolve a stable TINDIO profile identity.");
console.log(`Direct Neon current_profile_id: PASS (attempt ${neonIdentityAttempts})`);

const { body: bootstrapBody, attempts: bearerBootstrapAttempts } = await expectJsonResponse({
  url: deploymentEndpoint("/api/pos/v1/bootstrap"),
  init: { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
  expectedStatus: 200,
  label: "Deployed bearer POS bootstrap",
});
assert.equal(typeof bootstrapBody?.organization?.id, "string", "Deployed bearer POS bootstrap did not return an organization.");
assert.equal(typeof bootstrapBody?.employee?.id, "string", "Deployed bearer POS bootstrap did not return an employee.");
console.log(`Deployed bearer POS bootstrap: PASS (attempt ${bearerBootstrapAttempts})`);

const { attempts: crossTenantAttempts } = await expectJsonResponse({
  url: deploymentEndpoint("/api/pos/v1/bootstrap"),
  init: { headers: { Authorization: `Bearer ${token}`, "X-Tindio-Organization-Id": randomUUID(), Accept: "application/json" } },
  expectedStatus: 401,
  label: "Deployed cross-tenant denial",
});
console.log(`Deployed cross-tenant denial: PASS (attempt ${crossTenantAttempts})`);

const { attempts: crossStoreAttempts } = await expectJsonResponse({
  url: deploymentEndpoint(`/api/pos/v1/catalog?store=${encodeURIComponent(randomUUID())}`),
  init: { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
  expectedStatus: 400,
  label: "Deployed cross-store denial",
});
console.log(`Deployed cross-store denial: PASS (attempt ${crossStoreAttempts})`);
await auth.auth.signOut();
console.log(protectionBypass ? "Vercel Preview protection bypass: ACTIVE" : "Vercel Preview protection bypass: NOT REQUIRED");
console.log(`Browser final pathname: ${browserResult.pathname}`);
console.log(`Browser certification attempts: ${browserResult.attempts}`);
console.log("PHASE 04 DEPLOYED CERTIFICATION: PASS");
