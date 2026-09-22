import {
  randomUUID,
} from "node:crypto";
import {
  spawn,
} from "node:child_process";
import process from "node:process";

import {
  createClient,
} from "@supabase/supabase-js";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const appUrl =
  "http://127.0.0.1:3100";

const supabaseUrl =
  process.env
    .NEXT_PUBLIC_SUPABASE_URL;

const publishableKey =
  process.env
    .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const neonDataApiUrl =
  process.env
    .NEON_DATA_API_URL;

const email =
  process.env
    .TINDIO_PHASE_04_TEST_EMAIL;

const password =
  process.env
    .TINDIO_PHASE_04_TEST_PASSWORD;

if (
  process.env
    .TINDIO_DATABASE_PROVIDER
  !== "neon"
) {
  fail(
    "Set TINDIO_DATABASE_PROVIDER=neon for Phase 04 API certification.",
  );
}

if (
  !supabaseUrl
  || !publishableKey
  || !neonDataApiUrl
  || !email
  || !password
) {
  fail(
    "Phase 04 API certification requires Supabase Auth, Neon Data API, and disposable preproduction test-account environment variables.",
  );
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

if (
  error
  || !data.session
) {
  fail(
    `Phase 04 test sign-in failed: ${error?.message ?? "missing session"}`,
  );
}

const token =
  data.session.access_token;

const dataApiBase =
  neonDataApiUrl
    .replace(
      /\/$/,
      "",
    );

const directIdentity =
  await fetch(
    `${dataApiBase}/rpc/current_profile_id`,
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

if (
  !directIdentity.ok
) {
  fail(
    `Neon Data API identity RPC failed with HTTP ${directIdentity.status}.`,
  );
}

const directProfileId =
  await directIdentity
    .json();

if (
  typeof directProfileId
  !== "string"
  || directProfileId.length
    === 0
) {
  fail(
    "Neon Data API did not resolve the stable TINDIO profile.",
  );
}

const server =
  spawn(
    "pnpm",
    [
      "exec",
      "next",
      "start",
      "-p",
      "3100",
    ],
    {
      env:
        process.env,

      stdio:
        [
          "ignore",
          "inherit",
          "inherit",
        ],

      shell:
        process.platform
        === "win32",
    },
  );

async function waitForServer() {
  for (
    let attempt = 0;
    attempt < 60;
    attempt += 1
  ) {
    try {
      const response =
        await fetch(
          `${appUrl}/login`,
        );

      if (
        response.ok
        || response.status
          < 500
      ) {
        return;
      }
    } catch {
      // retry
    }

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          1_000,
        ),
    );
  }

  fail(
    "TINDIO server did not start for Phase 04 certification.",
  );
}

try {
  await waitForServer();

  const bootstrap =
    await fetch(
      `${appUrl}/api/pos/v1/bootstrap`,
      {
        headers: {
          Authorization:
            `Bearer ${token}`,
        },
      },
    );

  if (
    !bootstrap.ok
  ) {
    fail(
      `Neon-backed TINDIO bootstrap failed with HTTP ${bootstrap.status}.`,
    );
  }

  const body =
    await bootstrap.json();

  if (
    body?.employee?.id
      === undefined
    || body?.organization?.id
      === undefined
  ) {
    fail(
      "Neon-backed bootstrap returned an invalid business context.",
    );
  }

  const foreignOrganization =
    randomUUID();

  const foreign =
    await fetch(
      `${appUrl}/api/pos/v1/bootstrap`,
      {
        headers: {
          Authorization:
            `Bearer ${token}`,

          "X-Tindio-Organization-Id":
            foreignOrganization,
        },
      },
    );

  if (
    foreign.status !== 401
  ) {
    fail(
      `Cross-tenant Neon request expected HTTP 401, received ${foreign.status}.`,
    );
  }

  const foreignStore =
    randomUUID();

  const catalog =
    await fetch(
      `${appUrl}/api/pos/v1/catalog?store=${encodeURIComponent(foreignStore)}`,
      {
        headers: {
          Authorization:
            `Bearer ${token}`,
        },
      },
    );

  if (
    catalog.status !== 400
  ) {
    fail(
      `Cross-store Neon request expected HTTP 400, received ${catalog.status}.`,
    );
  }

  console.log(
    "PHASE 04 NEON API CERTIFICATION: PASS",
  );
} finally {
  server.kill();
}
