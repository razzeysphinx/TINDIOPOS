import assert from "node:assert/strict";
import {
  randomUUID,
} from "node:crypto";
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
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET
    ?.trim()
  || null;

const auth =
  createClient(
    supabaseUrl,
    publishableKey,
    {
      auth: {
        persistSession:
          false,
        autoRefreshToken:
          false,
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
);

assert.ok(
  data.session,
);

const token =
  data.session.access_token;

const statusCounts = {};
const failures = [];

for (
  let attempt = 1;
  attempt <= 500;
  attempt += 1
) {
  const headers =
    new Headers({
      Authorization:
        `Bearer ${token}`,
      Accept:
        "application/json",
    });

  if (bypass) {
    headers.set(
      "x-vercel-protection-bypass",
      bypass,
    );
  }

  const response =
    await fetch(
      new URL(
        "/api/pos/v2/bootstrap",
        deployment,
      ),
      {
        method: "GET",
        cache: "no-store",
        headers,
      },
    );

  const status =
    String(response.status);

  statusCounts[status] =
    (statusCounts[status] ?? 0)
    + 1;

  if (
    response.status !== 200
  ) {
    failures.push({
      attempt,
      status:
        response.status,
      requestId:
        response.headers.get(
          "x-tindio-request-id",
        ),
    });
  }

  await response
    .arrayBuffer()
    .catch(() => null);
}

console.log(
  "V2_STATUS_DISTRIBUTION:",
  JSON.stringify(
    statusCounts,
  ),
);

console.log(
  "V2_FAILURES:",
  JSON.stringify(
    failures,
  ),
);

assert.equal(
  failures.length,
  0,
  `V2 core failed ${failures.length}/500 requests.`,
);

const crossTenant =
  await fetch(
    new URL(
      "/api/pos/v2/bootstrap",
      deployment,
    ),
    {
      headers: {
        Authorization:
          `Bearer ${token}`,
        Accept:
          "application/json",
        "X-Tindio-Organization-Id":
          randomUUID(),
        ...(bypass
          ? {
              "x-vercel-protection-bypass":
                bypass,
            }
          : {}),
      },
    },
  );

assert.equal(
  crossTenant.status,
  403,
);

await auth.auth
  .signOut()
  .catch(() => null);

console.log(
  "PHASE 04 POS V2 CORE DEPLOYED: PASS 500/500",
);
