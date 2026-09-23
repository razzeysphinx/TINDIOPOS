import assert from "node:assert/strict";
import {
  randomUUID,
} from "node:crypto";
import process from "node:process";

import {
  chromium,
} from "@playwright/test";

import {
  createClient,
} from "@supabase/supabase-js";

function required(
  name,
) {
  const value =
    process.env[name];

  if (
    typeof value !== "string"
    || value.trim() === ""
  ) {
    throw new Error(
      `${name} is required.`,
    );
  }

  return value.trim();
}

const deploymentUrl =
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

const neonDataApiUrl =
  required(
    "NEON_DATA_API_URL",
  );

const email =
  required(
    "TINDIO_PHASE_04_TEST_EMAIL",
  );

const password =
  required(
    "TINDIO_PHASE_04_TEST_PASSWORD",
  );

const protectionBypass =
  process.env
    .VERCEL_AUTOMATION_BYPASS_SECRET
    ?.trim()
  || null;

function protectedHeaders(
  headers,
) {
  const result =
    new Headers(
      headers,
    );

  if (
    protectionBypass
  ) {
    result.set(
      "x-vercel-protection-bypass",
      protectionBypass,
    );
  }

  return result;
}

if (
  protectionBypass
) {
  const apiBypassHeaders =
    protectedHeaders();

  assert.equal(
    apiBypassHeaders.get(
      "x-vercel-protection-bypass",
    ),
    protectionBypass,
    "API bypass header is missing.",
  );

  assert.equal(
    apiBypassHeaders.has(
      "x-vercel-set-bypass-cookie",
    ),
    false,
    "Node fetch must not request Vercel bypass-cookie redirects.",
  );
}

const request = async (
  pathname,
  init = {},
) =>
  fetch(
    new URL(
      pathname,
      deploymentUrl,
    ),
    {
      ...init,

      headers:
        protectedHeaders(
          init.headers,
        ),
    },
  );

/*
 * FIRST: use the real TINDIO login flow.
 *
 * The application login action is the authoritative provisioning boundary:
 *
 * Supabase Auth
 * → ensureCurrentIdentityProfile()
 * → Neon profile
 * → private.identity_links
 * → business membership
 *
 * Do not test mobile bearer bootstrap before this boundary has run.
 */
const browser =
  await chromium.launch();

try {
  const browserHeaders =
    protectionBypass
      ? {
          "x-vercel-protection-bypass":
            protectionBypass,

          "x-vercel-set-bypass-cookie":
            "true",
        }
      : {};

  const context =
    await browser
      .newContext({
        extraHTTPHeaders:
          browserHeaders,
      });

  const page =
    await context
      .newPage();

  const response =
    await page.goto(
      new URL(
        "/login",
        deploymentUrl,
      ).toString(),
      {
        waitUntil:
          "networkidle",
      },
    );

  assert.ok(
    response,
    "Deployed login navigation returned no response.",
  );

  assert.ok(
    response.ok(),
    `Deployed browser login page returned HTTP ${response.status()}.`,
  );

  await page
    .getByLabel(
      "Email",
    )
    .fill(
      email,
    );

  await page
    .getByLabel(
      "Password",
      {
        exact:
          true,
      },
    )
    .fill(
      password,
    );

  await Promise.all([
    page.waitForURL(
      (url) =>
        !url.pathname
          .startsWith(
            "/login",
          ),
      {
        timeout:
          30_000,
      },
    ),

    page
      .getByRole(
        "button",
        {
          name:
            "Sign in",
        },
      )
      .click(),
  ]);

  await page.waitForLoadState(
    "networkidle",
  );

  const signedInUrl =
    new URL(
      page.url(),
    );

  assert.ok(
    !signedInUrl.pathname
      .startsWith(
        "/login",
      ),
    "Deployed TINDIO login did not leave the login page.",
  );

  assert.ok(
    !signedInUrl.pathname
      .startsWith(
        "/onboarding",
      ),
    "The Phase 04 certification account has no completed TINDIO business membership. Complete normal onboarding before bearer POS certification.",
  );

  assert.ok(
    !signedInUrl.pathname
      .startsWith(
        "/workspace/no-access",
      ),
    "The Phase 04 owner certification account resolved its business context but no authorized workspace. Owner RBAC/store scope must remain usable after Neon cutover.",
  );

  console.log(
    "Deployed TINDIO login + identity provisioning: PASS",
  );

  await context.close();
} finally {
  await browser.close();
}

/*
 * SECOND: mint a fresh bearer token only after TINDIO has established the
 * stable provider-neutral identity mapping.
 */
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
  `Hosted Supabase bearer sign-in failed: ${error?.message ?? "unknown error"}`,
);

assert.ok(
  data.session,
  "Hosted Supabase did not return a bearer certification session.",
);

const token =
  data.session
    .access_token;

/*
 * THIRD: prove the identity exists at the authoritative Neon boundary before
 * asking the deployed POS route to construct a full business context.
 */
const directIdentity =
  await fetch(
    new URL(
      "/rpc/current_profile_id",
      neonDataApiUrl.endsWith("/")
        ? neonDataApiUrl
        : `${neonDataApiUrl}/`,
    ),
    {
      method:
        "POST",

      headers: {
        Authorization:
          `Bearer ${token}`,

        "Content-Type":
          "application/json",
      },

      body:
        "{}",
    },
  );

assert.equal(
  directIdentity.status,
  200,
  `Direct Neon current_profile_id returned HTTP ${directIdentity.status}.`,
);

const directProfileId =
  await directIdentity.json();

assert.ok(
  typeof directProfileId === "string"
  && directProfileId.length > 0,
  "TINDIO login completed, but Neon still did not resolve a stable profile identity.",
);

console.log(
  "Direct Neon current_profile_id: PASS",
);

/*
 * FOURTH: certify the deployed mobile-safe bearer POS contract.
 */
const loginPage =
  await request(
    "/login",
  );

assert.ok(
  loginPage.ok,
  `Deployed login page returned HTTP ${loginPage.status}.`,
);

const bootstrap =
  await request(
    "/api/pos/v1/bootstrap",
    {
      headers: {
        Authorization:
          `Bearer ${token}`,
      },
    },
  );

const bootstrapContentType =
  bootstrap.headers
    .get(
      "content-type",
    )
  ?? "";

assert.match(
  bootstrapContentType,
  /application\/json/i,
  "Deployed bootstrap returned non-JSON content.",
);

assert.equal(
  bootstrap.status,
  200,
  `Deployed bearer bootstrap returned HTTP ${bootstrap.status}.`,
);

const bootstrapBody =
  await bootstrap.json();

assert.ok(
  bootstrapBody
  && typeof bootstrapBody
    === "object",
  "Deployed POS bootstrap returned an invalid body.",
);

assert.ok(
  typeof bootstrapBody
    ?.organization
    ?.id
    === "string",
  "Deployed POS bootstrap did not return an organization.",
);

assert.ok(
  typeof bootstrapBody
    ?.employee
    ?.id
    === "string",
  "Deployed POS bootstrap did not return an employee.",
);

console.log(
  "Deployed bearer POS bootstrap: PASS",
);

const crossTenant =
  await request(
    "/api/pos/v1/bootstrap",
    {
      headers: {
        Authorization:
          `Bearer ${token}`,

        "X-Tindio-Organization-Id":
          randomUUID(),
      },
    },
  );

assert.equal(
  crossTenant.status,
  401,
  `Cross-tenant deployed request expected HTTP 401, received ${crossTenant.status}.`,
);

console.log(
  "Deployed cross-tenant denial: PASS",
);

const crossStore =
  await request(
    `/api/pos/v1/catalog?store=${encodeURIComponent(randomUUID())}`,
    {
      headers: {
        Authorization:
          `Bearer ${token}`,
      },
    },
  );

assert.equal(
  crossStore.status,
  400,
  `Cross-store deployed request expected HTTP 400, received ${crossStore.status}.`,
);

console.log(
  "Deployed cross-store denial: PASS",
);

await auth.auth
  .signOut();

console.log(
  protectionBypass
    ? "Vercel Preview protection bypass: ACTIVE"
    : "Vercel Preview protection bypass: NOT REQUIRED",
);

console.log(
  "PHASE 04 DEPLOYED CERTIFICATION: PASS",
);
