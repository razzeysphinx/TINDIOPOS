import { chromium } from "@playwright/test";

const BOOTSTRAP_TIMEOUT_MS = 45_000;
const MEASURED_NAVIGATION_TIMEOUT_MS = 10_000;
const AUTHENTICATED_BOOTSTRAP_PATH = "/back-office/purchasing?tab=purchase-orders";
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

class ProfileHarnessFailure extends Error {
  constructor({ stage, errorClass, timeoutMs, pathname, status = null }) {
    super(`${stage}: ${errorClass}`);
    this.stage = stage;
    this.errorClass = errorClass;
    this.timeoutMs = timeoutMs;
    this.pathname = pathname;
    this.status = status;
  }
}

function profileStage(stage, pathname = null) {
  console.log(`PROFILE_STAGE ${stage}${pathname ? ` ${pathname}` : ""}`);
}

function errorClass(error, fallback = "NAVIGATION_ERROR") {
  return error?.name === "TimeoutError" ? "TIMEOUT" : fallback;
}

function failureDetails(error, fallback) {
  if (error instanceof ProfileHarnessFailure) {
    return {
      stage: error.stage,
      error_class: error.errorClass,
      timeout_ms: error.timeoutMs,
      pathname: error.pathname,
      status: error.status,
    };
  }

  return {
    ...fallback,
    error_class: errorClass(error),
    status: null,
  };
}

async function bootstrapNavigation({ page, deployment, pathname, stage }) {
  profileStage(stage);
  const startedAt = performance.now();
  try {
    const response = await page.goto(deploymentUrl(deployment, pathname), {
      waitUntil: "domcontentloaded",
      timeout: BOOTSTRAP_TIMEOUT_MS,
    });
    const status = response?.status() ?? null;
    if (!response?.ok()) {
      throw new ProfileHarnessFailure({
        stage,
        errorClass: `HTTP_${status ?? "NO_RESPONSE"}`,
        timeoutMs: BOOTSTRAP_TIMEOUT_MS,
        pathname,
        status,
      });
    }
    return {
      success: true,
      duration_ms: Math.round(performance.now() - startedAt),
      timeout_ms: BOOTSTRAP_TIMEOUT_MS,
      pathname,
      status,
    };
  } catch (error) {
    if (error instanceof ProfileHarnessFailure) throw error;
    throw new ProfileHarnessFailure({
      stage,
      errorClass: errorClass(error),
      timeoutMs: BOOTSTRAP_TIMEOUT_MS,
      pathname,
    });
  }
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
  const loginPage = await bootstrapNavigation({
    page,
    deployment,
    pathname: "/login",
    stage: "login_page",
  });

  profileStage("sign_in");
  const signInStartedAt = performance.now();
  try {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: BOOTSTRAP_TIMEOUT_MS });
  } catch (error) {
    throw new ProfileHarnessFailure({
      stage: "sign_in",
      errorClass: errorClass(error, "SIGN_IN_ERROR"),
      timeoutMs: BOOTSTRAP_TIMEOUT_MS,
      pathname: "/login",
    });
  }

  const signIn = {
    success: true,
    duration_ms: Math.round(performance.now() - signInStartedAt),
    timeout_ms: BOOTSTRAP_TIMEOUT_MS,
    pathname: "/login",
  };
  const authenticatedBootstrap = await bootstrapNavigation({
    page,
    deployment,
    pathname: AUTHENTICATED_BOOTSTRAP_PATH,
    stage: "authenticated_bootstrap",
  });
  return { context, page, bootstrap: { login_page: loginPage, sign_in: signIn, authenticated_bootstrap: authenticatedBootstrap } };
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
  profileStage("measurement_begin");
  for (const pathname of PURCHASE_PATHS) {
    profileStage("measuring", pathname);
    const samples = [];
    for (const cacheState of ["cold", "warm", "warm", "warm", "warm", "warm"]) {
      const errorsBefore = pageErrors.length + consoleErrors.length;
      const startedAt = performance.now();
      let status = null;
      let fatal = null;
      try {
        const response = await page.goto(deploymentUrl(deployment, pathname), {
          waitUntil: "domcontentloaded",
          timeout: MEASURED_NAVIGATION_TIMEOUT_MS,
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
        failure: fatal
          ? {
              stage: "measurement",
              error_class: fatal,
              timeout_ms: MEASURED_NAVIGATION_TIMEOUT_MS,
              pathname,
              status,
            }
          : null,
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
    bootstrap_timeout_ms: BOOTSTRAP_TIMEOUT_MS,
    measured_navigation_timeout_ms: MEASURED_NAVIGATION_TIMEOUT_MS,
    protection_bypass: bypass ? "ACTIVE" : "NOT_REQUIRED",
    bootstrap: session.bootstrap,
    pages,
    page_error_count: pageErrors.length,
    console_error_count: consoleErrors.length,
  }, null, 2));
  console.log("PHASE 05 PURCHASING RUNTIME PROFILE: COMPLETE");
} catch (error) {
  const failure = failureDetails(error, {
    stage: "profile_bootstrap",
    timeout_ms: BOOTSTRAP_TIMEOUT_MS,
    pathname: AUTHENTICATED_BOOTSTRAP_PATH,
  });
  console.log(JSON.stringify({
    phase: "05C",
    kind: "targeted purchasing runtime profile",
    result: "BLOCKED_PREVIEW_SESSION_BOOTSTRAP",
    bootstrap_timeout_ms: BOOTSTRAP_TIMEOUT_MS,
    measured_navigation_timeout_ms: MEASURED_NAVIGATION_TIMEOUT_MS,
    failure,
  }, null, 2));
  console.log("PHASE 05 PURCHASING RUNTIME PROFILE: BLOCKED_PREVIEW_SESSION_BOOTSTRAP");
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => null);
  await browser.close();
}
