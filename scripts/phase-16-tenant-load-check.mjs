/*
 * Local-only Phase 16 concurrency check for the protected organization-export
 * route. It verifies that concurrent high-impact requests receive either a
 * streamed export (200) or the intended rate-limit response (429), never an
 * unbounded set of successful exports.
 *
 * Usage from PowerShell after signing in locally and copying the Cookie header
 * from a same-origin request in DevTools:
 *
 *   $env:TINDIO_TEST_URL = 'http://localhost:3000'
 *   $env:TINDIO_TEST_COOKIE = 'sb-localhost-auth-token=...'
 *   npm run test:tenant-load
 */

const baseUrl = process.env.TINDIO_TEST_URL ?? "http://localhost:3000";
const cookie = process.env.TINDIO_TEST_COOKIE;
const requestCount = Number.parseInt(process.env.TINDIO_TEST_REQUESTS ?? "12", 10);

if (!cookie) {
  console.error("Set TINDIO_TEST_COOKIE from a signed-in local browser request before running this check.");
  process.exit(1);
}

if (!Number.isInteger(requestCount) || requestCount < 1 || requestCount > 50) {
  console.error("TINDIO_TEST_REQUESTS must be an integer between 1 and 50.");
  process.exit(1);
}

const endpoint = new URL("/api/organization-export", baseUrl);
const startedAt = performance.now();

const responses = await Promise.all(
  Array.from({ length: requestCount }, async () => {
    const response = await fetch(endpoint, {
      headers: { cookie },
      redirect: "manual",
    });

    // The load check validates admission/rate limiting. It does not download a
    // potentially large export body for every concurrent request.
    await response.body?.cancel();
    return response.status;
  }),
);

const summary = responses.reduce((counts, status) => {
  counts[status] = (counts[status] ?? 0) + 1;
  return counts;
}, {});

const unexpectedStatuses = responses.filter((status) => status !== 200 && status !== 429);
const elapsedMilliseconds = Math.round(performance.now() - startedAt);

console.log(JSON.stringify({
  elapsedMilliseconds,
  requestCount,
  responses: summary,
}, null, 2));

if (unexpectedStatuses.length > 0) {
  console.error(`Unexpected export-load statuses: ${unexpectedStatuses.join(", ")}`);
  process.exit(1);
}

if (requestCount > 3 && !responses.includes(429)) {
  console.error("Expected at least one 429 after the three-per-hour export limit, but none was returned.");
  process.exit(1);
}
