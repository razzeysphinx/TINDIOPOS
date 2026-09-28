import { chromium } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";

const BOOTSTRAP_TIMEOUT_MS = 45_000;
const SESSION_SEED_TIMEOUT_MS = 15_000;
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

function normalizeSameSite(sameSite) {
  if (sameSite === "strict" || sameSite === "Strict") return "Strict";
  if (sameSite === "none" || sameSite === "None") return "None";
  return "Lax";
}

async function createAuthenticatedSessionCookies({ supabaseUrl, publishableKey, email, password, deployment }) {
  const cookieJar = new Map();
  const supabase = createServerClient(supabaseUrl, publishableKey, {
    cookies: {
      getAll() {
        return [...cookieJar.values()].map(({ name, value }) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) cookieJar.set(cookie.name, cookie);
      },
    },
  });
  const startedAt = performance.now();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new ProfileHarnessFailure({
      stage: "session_seed",
      errorClass: "SUPABASE_SIGN_IN_FAILED",
      timeoutMs: SESSION_SEED_TIMEOUT_MS,
      pathname: deployment.pathname,
    });
  }
  const cookieEntries = [...cookieJar.values()];
  const authCookies = cookieEntries.filter(
    (cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("auth-token"),
  );
  if (authCookies.length === 0) {
    throw new ProfileHarnessFailure({
      stage: "session_seed",
      errorClass: "SSR_AUTH_COOKIES_NOT_GENERATED",
      timeoutMs: SESSION_SEED_TIMEOUT_MS,
      pathname: deployment.pathname,
    });
  }
  return {
    browserCookies: cookieEntries.map((cookie) => {
      const options = cookie.options ?? {};
      return {
        name: cookie.name,
        value: cookie.value,
        url: deployment.origin,
        path: options.path ?? "/",
        httpOnly: options.httpOnly ?? false,
        secure: options.secure ?? true,
        sameSite: normalizeSameSite(options.sameSite),
      };
    }),
    authCookieCount: authCookies.length,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
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

async function createSessionSeededBrowser({ browser, deployment, supabaseUrl, publishableKey, email, password, bypass }) {
  const sessionSeed = await createAuthenticatedSessionCookies({
    supabaseUrl,
    publishableKey,
    email,
    password,
    deployment,
  });
  const headers = { "x-vercel-protection-bypass": bypass };
  const context = await browser.newContext({ extraHTTPHeaders: headers });
  try {
    await context.addCookies(sessionSeed.browserCookies);
    const page = await context.newPage();
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
        auth_mode: "supabase_ssr_session_seed",
        session_seed: "PASS",
        session_seed_elapsed_ms: sessionSeed.elapsedMs,
        supabase_auth_cookie_count: sessionSeed.authCookieCount,
        authenticated_bootstrap: authenticatedBootstrap,
      },
    };
  } catch (error) {
    await context.close().catch(() => null);
    if (error instanceof ProfileHarnessFailure) throw error;
    throw new ProfileHarnessFailure({
      stage: "authenticated_bootstrap",
      errorClass: errorClass(error, "SEEDED_SESSION_BOOTSTRAP_ERROR"),
      timeoutMs: BOOTSTRAP_TIMEOUT_MS,
      pathname: AUTHENTICATED_BOOTSTRAP_PATH,
    });
  }
}

const deployment = new URL(required("TINDIO_PHASE_05_DEPLOYMENT_URL"));
const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
const publishableKey = required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const email = required("TINDIO_PHASE_05_TEST_EMAIL");
const password = required("TINDIO_PHASE_05_TEST_PASSWORD");
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || null;
if (!bypass) {
  throw new Error("VERCEL_AUTOMATION_BYPASS_SECRET is required for this protected Preview.");
}
const browser = await chromium.launch();
let context;

try {
  const session = await createSessionSeededBrowser({
    browser,
    deployment,
    supabaseUrl,
    publishableKey,
    email,
    password,
    bypass,
  });
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
  const result = failure.stage === "session_seed"
    ? "BLOCKED_SESSION_SEED"
    : failure.stage === "authenticated_bootstrap"
      ? "BLOCKED_SEEDED_SESSION_REJECTED"
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
