import { chromium } from "@playwright/test";

const BOOTSTRAP_TIMEOUT_MS = 45_000;
const AUTH_SESSION_TIMEOUT_MS = 15_000;
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
  constructor({ stage, errorClass, timeoutMs, pathname, status = null, safeAlert = null, loginPostObserved = null, loginResponseStatus = null }) {
    super(`${stage}: ${errorClass}`);
    this.stage = stage;
    this.errorClass = errorClass;
    this.timeoutMs = timeoutMs;
    this.pathname = pathname;
    this.status = status;
    this.safeAlert = safeAlert;
    this.loginPostObserved = loginPostObserved;
    this.loginResponseStatus = loginResponseStatus;
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
      safe_alert: error.safeAlert,
      login_post_observed: error.loginPostObserved,
      login_response_status: error.loginResponseStatus,
    };
  }

  return {
    ...fallback,
    error_class: errorClass(error),
    status: null,
  };
}

function isSupabaseAuthCookieName(name) {
  return name.startsWith("sb-") && name.includes("auth-token");
}

async function supabaseAuthCookieCount(context) {
  const cookies = await context.cookies();
  return cookies.filter((cookie) => isSupabaseAuthCookieName(cookie.name)).length;
}

async function waitForSupabaseAuthCookie({ context, timeoutMs }) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const count = await supabaseAuthCookieCount(context);
    if (count > 0) {
      return { success: true, count, elapsed_ms: Math.round(performance.now() - startedAt) };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { success: false, count: 0, elapsed_ms: Math.round(performance.now() - startedAt) };
}

async function bootstrapNavigation({ page, deployment, pathname, stage, expectedPathPrefix = null }) {
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
    const finalPathname = new URL(page.url()).pathname;
    if (expectedPathPrefix && !finalPathname.startsWith(expectedPathPrefix)) {
      throw new ProfileHarnessFailure({
        stage,
        errorClass: "UNEXPECTED_PATHNAME",
        timeoutMs: BOOTSTRAP_TIMEOUT_MS,
        pathname: finalPathname,
        status,
      });
    }
    return {
      success: true,
      duration_ms: Math.round(performance.now() - startedAt),
      timeout_ms: BOOTSTRAP_TIMEOUT_MS,
      pathname,
      final_pathname: finalPathname,
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
  const headers = { "x-vercel-protection-bypass": bypass };
  const context = await browser.newContext({ extraHTTPHeaders: headers });
  const page = await context.newPage();
  try {
    const loginPage = await bootstrapNavigation({
      page,
      deployment,
      pathname: "/login",
      stage: "login_page",
      expectedPathPrefix: "/login",
    });
    profileStage("sign_in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    const authCookieCountBefore = await supabaseAuthCookieCount(context);
    const loginTransport = { postObserved: false, responseStatus: null };
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).host === deployment.host) {
        loginTransport.postObserved = true;
      }
    });
    page.on("response", (response) => {
      const request = response.request();
      if (request.method() === "POST" && new URL(request.url()).host === deployment.host) {
        loginTransport.responseStatus = response.status();
      }
    });
    await page.getByRole("button", { name: "Sign in" }).click();
    const sessionCommit = await waitForSupabaseAuthCookie({
      context,
      timeoutMs: AUTH_SESSION_TIMEOUT_MS,
    });
    if (!sessionCommit.success) {
      const alert = page.getByRole("alert");
      const alertVisible = await alert.isVisible().catch(() => false);
      const alertText = alertVisible ? (await alert.textContent())?.trim() : null;
      throw new ProfileHarnessFailure({
        stage: "sign_in",
        errorClass: alertText ? "LOGIN_APPLICATION_ERROR" : "AUTH_COOKIE_NOT_COMMITTED",
        timeoutMs: AUTH_SESSION_TIMEOUT_MS,
        pathname: new URL(page.url()).pathname,
        safeAlert: alertText ? "PRESENT" : null,
        loginPostObserved: loginTransport.postObserved,
        loginResponseStatus: loginTransport.responseStatus,
      });
    }
    const loginPathAfterCookieCommit = new URL(page.url()).pathname;
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const authenticatedBootstrap = await bootstrapNavigation({
      page,
      deployment,
      pathname: AUTHENTICATED_BOOTSTRAP_PATH,
      stage: "authenticated_bootstrap",
      expectedPathPrefix: "/back-office/purchasing",
    });
    return {
      context,
      page,
      pageErrors,
      consoleErrors,
      bootstrap: {
        auth_mode: "cookie_commit",
        login_page: loginPage,
        auth_cookie_count_before: authCookieCountBefore,
        auth_cookie_count_after: sessionCommit.count,
        auth_cookie_commit_elapsed_ms: sessionCommit.elapsed_ms,
        login_path_after_cookie_commit: loginPathAfterCookieCommit,
        authenticated_bootstrap: authenticatedBootstrap,
      },
    };
  } catch (error) {
    await context.close().catch(() => null);
    if (error instanceof ProfileHarnessFailure) throw error;
    throw new ProfileHarnessFailure({
      stage: "sign_in",
      errorClass: errorClass(error, "SIGN_IN_ERROR"),
      timeoutMs: AUTH_SESSION_TIMEOUT_MS,
      pathname: new URL(page.url()).pathname,
    });
  }
}

const deployment = new URL(required("TINDIO_PHASE_05_DEPLOYMENT_URL"));
const email = required("TINDIO_PHASE_05_TEST_EMAIL");
const password = required("TINDIO_PHASE_05_TEST_PASSWORD");
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || null;
if (!bypass) {
  throw new Error("VERCEL_AUTOMATION_BYPASS_SECRET is required for this protected Preview.");
}
const browser = await chromium.launch();
let context;

try {
  const session = await signInBrowser({ browser, deployment, email, password, bypass });
  context = session.context;
  const page = session.page;
  const pageErrors = session.pageErrors;
  const consoleErrors = session.consoleErrors;

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
  const result = failure.stage === "authenticated_bootstrap"
    ? "BLOCKED_AUTH_COOKIE_SESSION"
    : failure.stage === "login_page" || failure.stage === "sign_in"
      ? "BLOCKED_AUTH_COOKIE_COMMIT"
      : "BLOCKED_PURCHASING_PROFILE";
  console.log(JSON.stringify({
    phase: "05C",
    kind: "targeted purchasing runtime profile",
    result,
    bootstrap_timeout_ms: BOOTSTRAP_TIMEOUT_MS,
    measured_navigation_timeout_ms: MEASURED_NAVIGATION_TIMEOUT_MS,
    failure,
  }, null, 2));
  console.log(`PHASE 05 PURCHASING RUNTIME PROFILE: ${result}`);
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => null);
  await browser.close();
}
