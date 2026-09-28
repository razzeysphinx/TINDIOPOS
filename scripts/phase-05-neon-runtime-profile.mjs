import process from "node:process";

import {
  chromium,
} from "@playwright/test";
import {
  createClient,
} from "@supabase/supabase-js";

import {
  runSql,
} from "./lib/phase-04-postgres-docker.mjs";

const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_PATHS = [
  "/back-office",
  "/back-office/catalog",
  "/back-office/inventory",
  "/back-office/purchasing",
  "/back-office/reports",
  "/back-office/devices",
  "/back-office/offline-sync",
];

function required(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function quantile(values, fraction) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );

  return Math.round(sorted[index]);
}

function classify(duration, timeoutCount, failureCount, thresholds) {
  if (timeoutCount > 0 || failureCount > 0 || duration === null) {
    return "HARDEN_REQUIRED";
  }

  if (duration <= thresholds.good) {
    return "GOOD";
  }

  if (duration <= thresholds.watch) {
    return "WATCH";
  }

  return "HARDEN_REQUIRED";
}

function totalConnections(snapshot) {
  return Object.values(snapshot.activity)
    .reduce((total, count) => total + Number(count), 0);
}

function counterDelta(before, after) {
  const delta = {};

  for (const [name, value] of Object.entries(after.database ?? {})) {
    if (name === "datname") {
      continue;
    }

    delta[name] = Number(value) - Number(before.database?.[name] ?? 0);
  }

  return delta;
}

function deploymentUrl(deployment, pathname) {
  return new URL(pathname, deployment).toString();
}

function protectedHeaders(bypass, initial = {}) {
  const headers = new Headers(initial);

  if (bypass) {
    headers.set("x-vercel-protection-bypass", bypass);
  }

  return headers;
}

function redactStatement(value) {
  return value
    .replace(/'(?:[^']|'')*'/g, "?")
    .replace(/\$\d+/g, "?")
    .replace(/\b\d+(?:\.\d+)?\b/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function safeJsonQuery(databaseUrl, sql) {
  return JSON.parse(runSql(databaseUrl, sql));
}

function readDatabaseSnapshot(databaseUrl) {
  return safeJsonQuery(
    databaseUrl,
    `
select jsonb_build_object(
  'database', (
    select to_jsonb(database_stat)
    from (
      select
        datname,
        numbackends,
        xact_commit,
        xact_rollback,
        blks_read,
        blks_hit,
        tup_returned,
        tup_fetched,
        tup_inserted,
        tup_updated,
        tup_deleted,
        temp_files,
        temp_bytes
      from pg_stat_database
      where datname = current_database()
    ) database_stat
  ),
  'activity', coalesce((
    select jsonb_object_agg(
      coalesce(state, 'unknown'),
      state_count
    )
    from (
      select state, count(*)::integer as state_count
      from pg_stat_activity
      where datname = current_database()
      group by state
    ) activity_counts
  ), '{}'::jsonb),
  'pg_stat_statements_available', exists (
    select 1
    from pg_extension
    where extname = 'pg_stat_statements'
  )
)::text;
`,
  );
}

function readStatements(databaseUrl) {
  const snapshot = readDatabaseSnapshot(databaseUrl);

  if (!snapshot.pg_stat_statements_available) {
    return {
      available: false,
      statements: [],
    };
  }

  try {
    const statements = safeJsonQuery(
      databaseUrl,
      `
select coalesce(jsonb_agg(to_jsonb(statement_row)), '[]'::jsonb)::text
from (
  select
    queryid::text as query_id,
    calls,
    total_exec_time,
    mean_exec_time,
    rows,
    query
  from public.pg_stat_statements
  where dbid = (select oid from pg_database where datname = current_database())
  order by total_exec_time desc
  limit 250
) statement_row;
`,
    );

    return {
      available: true,
      statements: statements.map((statement) => ({
        ...statement,
        query: redactStatement(statement.query),
      })),
    };
  } catch {
    return {
      available: false,
      reason: "pg_stat_statements is unavailable to the supplied database role.",
      statements: [],
    };
  }
}

function changedStatements(before, after) {
  if (!before.available || !after.available) {
    return {
      available: false,
      statements: [],
    };
  }

  const beforeById = new Map(
    before.statements.map((statement) => [statement.query_id, statement]),
  );

  const statements = after.statements
    .map((statement) => {
      const previous = beforeById.get(statement.query_id);
      const calls = Number(statement.calls) - Number(previous?.calls ?? 0);
      const totalExecTime = Number(statement.total_exec_time) - Number(
        previous?.total_exec_time ?? 0,
      );
      const rows = Number(statement.rows) - Number(previous?.rows ?? 0);

      return {
        query: statement.query,
        calls,
        total_exec_time_ms: Math.max(0, Math.round(totalExecTime)),
        mean_exec_time_ms: Number(statement.mean_exec_time),
        rows: Math.max(0, rows),
      };
    })
    .filter((statement) => statement.calls > 0 || statement.total_exec_time_ms > 0)
    .sort((left, right) => right.total_exec_time_ms - left.total_exec_time_ms)
    .slice(0, 20);

  return {
    available: true,
    statements,
  };
}

async function measureHttpEndpoint({
  name,
  count,
  request,
}) {
  const durations = [];
  const statuses = {};
  const failures = [];
  let timeoutCount = 0;

  for (let index = 1; index <= count; index += 1) {
    const startedAt = performance.now();

    try {
      const response = await request();
      const duration = performance.now() - startedAt;
      durations.push(duration);
      const status = String(response.status);
      statuses[status] = (statuses[status] ?? 0) + 1;

      if (response.status < 200 || response.status >= 300) {
        failures.push({
          index,
          status: response.status,
          request_id: response.headers.get("x-tindio-request-id") ?? null,
        });
      }

      await response.arrayBuffer().catch(() => null);
    } catch (error) {
      const duration = performance.now() - startedAt;
      durations.push(duration);
      const status = error?.name === "TimeoutError" ? "TIMEOUT" : "TRANSPORT_ERROR";
      statuses[status] = (statuses[status] ?? 0) + 1;

      if (status === "TIMEOUT") {
        timeoutCount += 1;
      }

      failures.push({ index, status });
    }
  }

  const p95 = quantile(durations, 0.95);

  return {
    name,
    count,
    status_distribution: statuses,
    min_ms: durations.length ? Math.round(Math.min(...durations)) : null,
    p50_ms: quantile(durations, 0.5),
    p95_ms: p95,
    max_ms: durations.length ? Math.round(Math.max(...durations)) : null,
    timeout_count: timeoutCount,
    failure_count: failures.length,
    failures,
    classification: classify(p95, timeoutCount, failures.length, {
      good: 750,
      watch: 1_500,
    }),
  };
}

async function signInBrowser({
  browser,
  deployment,
  email,
  password,
  bypass,
}) {
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

  if (!response?.ok()) {
    throw new Error(`Profile login returned HTTP ${response?.status() ?? "no response"}.`);
  }

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(
    (url) => !url.pathname.startsWith("/login"),
    { timeout: 30_000 },
  );

  return { context, page };
}

async function measureBackOffice({
  deployment,
  email,
  password,
  bypass,
}) {
  const browser = await chromium.launch();
  let context;

  try {
    const session = await signInBrowser({
      browser,
      deployment,
      email,
      password,
      bypass,
    });
    context = session.context;
    const page = session.page;
    const pageErrors = [];
    const consoleErrors = [];

    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    const pages = [];

    for (const pathname of PAGE_PATHS) {
      const samples = [];

      for (const cacheState of ["cold", "warm", "warm"]) {
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

          if (!response?.ok()) {
            fatal = `HTTP ${status ?? "no response"}`;
          }
        } catch (error) {
          fatal = error?.name === "TimeoutError" ? "TIMEOUT" : "NAVIGATION_ERROR";
        }

        const duration = performance.now() - startedAt;
        const errorCount = pageErrors.length + consoleErrors.length - errorsBefore;
        samples.push({
          cache_state: cacheState,
          success: fatal === null,
          status,
          duration_ms: Math.round(duration),
          fatal,
          error_count: errorCount,
        });
      }

      const warmDurations = samples
        .filter((sample) => sample.cache_state === "warm")
        .map((sample) => sample.duration_ms);
      const warmP95 = quantile(warmDurations, 0.95);
      const timeoutCount = samples.filter((sample) => sample.fatal === "TIMEOUT").length;
      const failureCount = samples.filter((sample) => !sample.success).length;

      pages.push({
        pathname,
        samples,
        warm_p95_ms: warmP95,
        classification: classify(warmP95, timeoutCount, failureCount, {
          good: 1_500,
          watch: 3_000,
        }),
      });
    }

    return {
      pages,
      page_error_count: pageErrors.length,
      console_error_count: consoleErrors.length,
    };
  } finally {
    await context?.close().catch(() => null);
    await browser.close();
  }
}

const deployment = new URL(required("TINDIO_PHASE_05_DEPLOYMENT_URL"));
const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
const publishableKey = required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const email = required("TINDIO_PHASE_05_TEST_EMAIL");
const password = required("TINDIO_PHASE_05_TEST_PASSWORD");
const databaseUrl = required("DATABASE_URL_UNPOOLED");
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || null;
const databaseHost = new URL(databaseUrl).hostname.toLowerCase();

if (!databaseHost.endsWith(".neon.tech") || databaseHost.includes("-pooler")) {
  throw new Error("DATABASE_URL_UNPOOLED must be a direct Neon endpoint.");
}

const auth = createClient(supabaseUrl, publishableKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  global: {
    fetch: (input, init) => fetch(input, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
  },
});

const report = {
  phase: "05B",
  kind: "measurement-only runtime and query cost profile",
  timeout_ms: REQUEST_TIMEOUT_MS,
  protection_bypass: bypass ? "ACTIVE" : "NOT_REQUIRED",
  database_before: null,
  database_delta: null,
  connection_baseline: null,
  observed_connection_peak: null,
  pg_stat_statements_window: null,
  http: [],
  back_office: null,
};

let statementsBefore;

try {
  report.database_before = readDatabaseSnapshot(databaseUrl);
  report.connection_baseline = totalConnections(report.database_before);
  statementsBefore = readStatements(databaseUrl);

  const { data, error } = await auth.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    throw new Error("Runtime profile authentication failed.");
  }

  const token = data.session.access_token;
  const bearerHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  const timedRequest = (pathname, init = {}) => fetch(
    deploymentUrl(deployment, pathname),
    {
      ...init,
      cache: "no-store",
      headers: protectedHeaders(bypass, init.headers),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );

  const coreResponse = await timedRequest("/api/pos/v2/bootstrap", {
    headers: bearerHeaders,
  });

  if (coreResponse.status !== 200) {
    throw new Error(`POS V2 core bootstrap returned HTTP ${coreResponse.status}.`);
  }

  const core = await coreResponse.json();
  const organizationId = core?.core?.organization?.id;
  const activeStoreId = core?.core?.activeShift?.storeId;
  const activeRegisterId = core?.core?.activeShift?.registerId;

  if (!organizationId || !activeStoreId || !activeRegisterId) {
    throw new Error("Runtime profile requires a dedicated account with an active POS shift.");
  }

  const organizationHeaders = {
    ...bearerHeaders,
    "X-Tindio-Organization-Id": organizationId,
  };
  const liveHeaders = {
    ...organizationHeaders,
    "X-Tindio-Store-Id": activeStoreId,
    "X-Tindio-Register-Id": activeRegisterId,
  };
  const catalogPath = `/api/pos/v2/catalog?store=${encodeURIComponent(activeStoreId)}&mode=search&offset=0&limit=24`;
  const catalogResponse = await timedRequest(catalogPath, {
    headers: organizationHeaders,
  });

  if (catalogResponse.status !== 200) {
    throw new Error(`POS V2 catalog discovery returned HTTP ${catalogResponse.status}.`);
  }

  const catalog = await catalogResponse.json();
  const productId = catalog?.items?.[0]?.productId;

  if (!productId) {
    throw new Error("Runtime profile requires a catalog item in the active test store.");
  }

  report.http.push(
    await measureHttpEndpoint({
      name: "core",
      count: 10,
      request: () => timedRequest("/api/pos/v2/bootstrap", {
        headers: bearerHeaders,
      }),
    }),
    await measureHttpEndpoint({
      name: "reference",
      count: 5,
      request: () => timedRequest("/api/pos/v2/reference", {
        headers: organizationHeaders,
      }),
    }),
    await measureHttpEndpoint({
      name: "live",
      count: 5,
      request: () => timedRequest("/api/pos/v2/live", {
        headers: liveHeaders,
      }),
    }),
    await measureHttpEndpoint({
      name: "catalog",
      count: 5,
      request: () => timedRequest(catalogPath, {
        headers: organizationHeaders,
      }),
    }),
    await measureHttpEndpoint({
      name: "modifiers",
      count: 3,
      request: () => timedRequest(
        `/api/pos/v2/modifiers?store=${encodeURIComponent(activeStoreId)}&product=${encodeURIComponent(productId)}`,
        { headers: organizationHeaders },
      ),
    }),
  );

  report.back_office = await measureBackOffice({
    deployment,
    email,
    password,
    bypass,
  });
} finally {
  const databaseAfter = readDatabaseSnapshot(databaseUrl);
  report.database_delta = counterDelta(report.database_before ?? {}, databaseAfter);
  report.observed_connection_peak = Math.max(
    report.connection_baseline ?? 0,
    totalConnections(databaseAfter),
  );
  report.pg_stat_statements_window = changedStatements(
    statementsBefore ?? { available: false, statements: [] },
    readStatements(databaseUrl),
  );
  await auth.auth.signOut().catch(() => null);
}

console.log(JSON.stringify(report, null, 2));
console.log("PHASE 05 NEON RUNTIME PROFILE: COMPLETE");
