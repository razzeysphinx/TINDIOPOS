import assert from "node:assert/strict";

function required(name) {
  const value = process.env[name]?.trim();

  assert.ok(value, `${name} is required.`);

  return value;
}

const previewUrl = new URL(required("TINDIO_R8_PREVIEW_URL"));
const cutoverBypass = required("TINDIO_CUTOVER_BYPASS_SECRET");
const vercelBypass = required("VERCEL_AUTOMATION_BYPASS_SECRET");

function headers(extra = {}) {
  return {
    "x-vercel-protection-bypass": vercelBypass,
    ...extra,
  };
}

function request(url, init = {}) {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(30_000),
  });
}

const api = await request(
  new URL("/api/pos/v2/bootstrap", previewUrl),
  {
    headers: headers(),
  },
);
assert.equal(api.status, 503, "Frozen preview API must return HTTP 503.");
assert.equal(api.headers.get("retry-after"), "60");
assert.equal(api.headers.get("cache-control"), "no-store");

const apiBody = await api.json();
assert.equal(apiBody.code, "CUTOVER_MAINTENANCE");
assert.equal(apiBody.retryable, true);

const bypassedApi = await request(
  new URL("/api/pos/v2/bootstrap", previewUrl),
  {
    headers: headers({
      "x-tindio-cutover-bypass": cutoverBypass,
    }),
  },
);
assert.equal(
  bypassedApi.status,
  401,
  "Authorized bypass must reach normal endpoint authentication.",
);

const browser = await request(
  new URL("/back-office?cutover-check=1", previewUrl),
  {
    headers: headers(),
    redirect: "manual",
  },
);
assert.ok([302, 303, 307, 308].includes(browser.status));
assert.equal(new URL(browser.headers.get("location"), previewUrl).pathname, "/maintenance");

const maintenance = await request(
  new URL("/maintenance", previewUrl),
  {
    headers: headers(),
  },
);
assert.equal(maintenance.status, 200);
const maintenanceHtml = await maintenance.text();
const staticAsset = maintenanceHtml.match(/(?:src|href)="(\/_next\/static\/[^"]+)"/u)?.[1];
assert.ok(staticAsset, "Maintenance page did not reference a Next static asset.");

const staticResponse = await request(
  new URL(staticAsset, previewUrl),
  {
    headers: headers(),
  },
);
assert.equal(staticResponse.status, 200);

console.log(
  JSON.stringify(
    {
      previewHost: previewUrl.hostname,
      api503: "PASS",
      retryAfter: "PASS",
      browserMaintenance: "PASS",
      staticAssets: "PASS",
      certificationBypass: "PASS",
    },
    null,
    2,
  ),
);
