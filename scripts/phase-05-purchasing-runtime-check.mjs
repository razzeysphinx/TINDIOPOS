import { chromium } from "@playwright/test";

const REQUEST_TIMEOUT_MS = 10_000;
const PURCHASE_PATHS = [
  "/back-office/purchasing?tab=purchase-orders",
  "/back-office/purchasing?tab=receiving",
  "/back-office/purchasing?tab=suppliers",
  "/back-office/purchasing?tab=supplier-returns",
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]);
}

function classify(duration, timeoutCount, failureCount) {
  if (timeoutCount > 0 || failureCount > 0 || duration === null) return "HARDEN_REQUIRED";
  if (duration <= 1_500) return "GOOD";
  if (duration <= 3_000) return "WATCH";
  return "HARDEN_REQUIRED";
}

function deploymentUrl(deployment, pathname) {
  return new URL(pathname, deployment).toString();
}

async function signInBrowser({ browser, deployment, email, password, bypass }) {
  const context = await browser.newContext({
    extraHTTPHeaders: bypass
      ? {
          "x-vercel-protection-bypass": bypass,
          "x-vercel-set-bypass-cookie": "true",
        }
      : {},
  });
  const page = await context.newPage();
  const response = await page.goto(deploymentUrl(deployment, "/login"), {
    waitUntil: "domcontentloaded",
    timeout: REQUEST_TIMEOUT_MS,
  });
  if (!response?.ok()) throw new Error(`Purchasing profile login returned HTTP ${response?.status() ?? "no response"}.`);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  return { context, page };
}

const deployment = new URL(required("TINDIO_PHASE_05_DEPLOYMENT_URL"));
const email = required("TINDIO_PHASE_05_TEST_EMAIL");
const password = required("TINDIO_PHASE_05_TEST_PASSWORD");
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || null;
const browser = await chromium.launch();
let context;

try {
  const session = await signInBrowser({ browser, deployment, email, password, bypass });
  context = session.context;
  const page = session.page;
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const pages = [];
  for (const pathname of PURCHASE_PATHS) {
    const samples = [];
    for (const cacheState of ["cold", "warm", "warm", "warm", "warm", "warm"]) {
      const errorsBefore = pageErrors.length + consoleErrors.length;
      const startedAt = performance.now();
      let status = null;
      let fatal = null;
      try {
        const response = await page.goto(deploymentUrl(deployment, pathname), {
          waitUntil: "domcontentloaded",
          timeout: REQUEST_TIMEOUT_MS,
        });
        status = response?.status() ?? null;
        if (!response?.ok()) fatal = `HTTP ${status ?? "no response"}`;
      } catch (error) {
        fatal = error?.name === "TimeoutError" ? "TIMEOUT" : "NAVIGATION_ERROR";
      }
      samples.push({
        cache_state: cacheState,
        success: fatal === null,
        status,
        duration_ms: Math.round(performance.now() - startedAt),
        fatal,
        error_count: pageErrors.length + consoleErrors.length - errorsBefore,
      });
    }
    const warmSamples = samples.filter((sample) => sample.cache_state === "warm");
    const timeoutCount = samples.filter((sample) => sample.fatal === "TIMEOUT").length;
    const failureCount = samples.filter((sample) => !sample.success).length;
    const warmP95 = quantile(warmSamples.map((sample) => sample.duration_ms), 0.95);
    pages.push({
      pathname,
      samples,
      warm_p95_ms: warmP95,
      classification: classify(warmP95, timeoutCount, failureCount),
    });
  }

  console.log(JSON.stringify({
    phase: "05C",
    kind: "targeted purchasing runtime profile",
    timeout_ms: REQUEST_TIMEOUT_MS,
    protection_bypass: bypass ? "ACTIVE" : "NOT_REQUIRED",
    pages,
    page_error_count: pageErrors.length,
    console_error_count: consoleErrors.length,
  }, null, 2));
  console.log("PHASE 05 PURCHASING RUNTIME PROFILE: COMPLETE");
} finally {
  await context?.close().catch(() => null);
  await browser.close();
}
