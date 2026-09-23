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

    result.set(
      "x-vercel-set-bypass-cookie",
      "true",
    );
  }

  return result;
}

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
  `Hosted Supabase login failed: ${error?.message ?? "unknown error"}`,
);

assert.ok(
  data.session,
  "Hosted Supabase did not return an authenticated session.",
);

const token =
  data.session
    .access_token;

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

const loginPage =
  await request(
    "/login",
  );

assert.ok(
  loginPage.ok,
  `Deployed login page returned HTTP ${loginPage.status}.`,
);

const loginContentType =
  loginPage.headers
    .get(
      "content-type",
    )
  ?? "";

assert.match(
  loginContentType,
  /text\/html/i,
  "Deployed login page did not return application HTML.",
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
  "Deployed bootstrap returned non-JSON content. If this is a protected Vercel Preview, configure VERCEL_AUTOMATION_BYPASS_SECRET.",
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
    await context.newPage();

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

  assert.ok(
    !new URL(
      page.url(),
    ).pathname
      .startsWith(
        "/login",
      ),
    "Deployed cookie-based login did not leave the login page.",
  );

  await context.close();
} finally {
  await browser.close();

  await auth.auth
    .signOut();
}

console.log(
  protectionBypass
    ? "Vercel Preview protection bypass: ACTIVE"
    : "Vercel Preview protection bypass: NOT REQUIRED",
);

console.log(
  "PHASE 04 DEPLOYED CERTIFICATION: PASS",
);
