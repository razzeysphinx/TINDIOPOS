import assert from "node:assert/strict";

import process from "node:process";

import {
  createClient,
} from "@supabase/supabase-js";

function required(name) {
  const value =
    process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `${name} is required.`,
    );
  }

  return value;
}

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms),
  );
}

function safeRegion(
  xVercelId,
) {
  if (!xVercelId) {
    return "unknown";
  }

  return xVercelId
    .split("::")
    .slice(0, 2)
    .join("::");
}

const deployment =
  new URL(
    required(
      "TINDIO_PHASE_04_DEPLOYMENT_URL",
    ),
  );

const supabaseUrl =
  required(
    "NEXT_PUBLIC_SUPABASE_URL",
  );

const publishableKey =
  required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );

const email =
  required(
    "TINDIO_PHASE_04_TEST_EMAIL",
  );

const password =
  required(
    "TINDIO_PHASE_04_TEST_PASSWORD",
  );

const bypass =
  process.env
    .VERCEL_AUTOMATION_BYPASS_SECRET
    ?.trim()
  || null;

const auth =
  createClient(
    supabaseUrl,
    publishableKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

const {
  data,
  error,
} =
  await auth.auth
    .signInWithPassword({
      email,
      password,
    });

assert.equal(
  error,
  null,
  `Bearer sign-in failed: ${
    error?.message
    ?? "unknown"
  }`,
);

assert.ok(
  data.session,
  "Bearer sign-in returned no session.",
);

const token =
  data.session.access_token;

const failures = [];
const regions = new Map();

for (
  let attempt = 1;
  attempt <= 100;
  attempt += 1
) {
  const headers =
    new Headers({
      Authorization:
        `Bearer ${token}`,

      Accept:
        "application/json",

      "Cache-Control":
        "no-cache, no-store",

      Pragma:
        "no-cache",
    });

  if (bypass) {
    headers.set(
      "x-vercel-protection-bypass",
      bypass,
    );
  }

  const url =
    new URL(
      "/api/pos/v1/bootstrap",
      deployment,
    );

  url.searchParams.set(
    "__phase04_stability",
    String(attempt),
  );

  const response =
    await fetch(
      url,
      {
        method:
          "GET",

        cache:
          "no-store",

        headers,
      },
    );

  const xVercelId =
    response.headers.get(
      "x-vercel-id",
    ) ?? "";

  const region =
    safeRegion(
      xVercelId,
    );

  regions.set(
    region,
    (regions.get(region) ?? 0)
      + 1,
  );

  const contentType =
    response.headers.get(
      "content-type",
    ) ?? "";

  if (
    response.status !== 200
    || !/application\/json/i.test(
      contentType,
    )
  ) {
    failures.push({
      attempt,
      status:
        response.status,
      contentType,
      region,
      xVercelCache:
        response.headers.get(
          "x-vercel-cache",
        ) ?? "",
      age:
        response.headers.get(
          "age",
        ) ?? "",
    });
  }

  await response
    .arrayBuffer()
    .catch(() => null);

  await sleep(100);
}

await auth.auth
  .signOut()
  .catch(() => null);

console.log(
  "Region distribution:",
  JSON.stringify(
    Object.fromEntries(
      regions,
    ),
  ),
);

console.log(
  "Failure summary:",
  JSON.stringify(
    failures,
  ),
);

assert.equal(
  failures.length,
  0,
  `Phase 04 deployed bearer stability failed on ${failures.length}/100 requests.`,
);

console.log(
  "PHASE 04 DEPLOYED AUTH STABILITY: PASS (100/100)",
);
