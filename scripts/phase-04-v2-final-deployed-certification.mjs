import assert from "node:assert/strict";
import {
  randomUUID,
} from "node:crypto";
import process from "node:process";

import {
  createClient,
} from "@supabase/supabase-js";

const REQUEST_TIMEOUT_MS = 10_000;

function required(name) {
  const value =
    process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function timedSupabaseFetch(input, init = {}) {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

const deployment =
  new URL(
    required("TINDIO_PHASE_04_DEPLOYMENT_URL"),
  );
const supabaseUrl =
  required("NEXT_PUBLIC_SUPABASE_URL");
const publishableKey =
  required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const neonDataApiUrl =
  required("NEON_DATA_API_URL");
const email =
  required("TINDIO_PHASE_04_TEST_EMAIL");
const password =
  required("TINDIO_PHASE_04_TEST_PASSWORD");
const bypass =
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()
  || null;

function sleep(milliseconds) {
  return new Promise(
    (resolve) => setTimeout(resolve, milliseconds),
  );
}

function protectedHeaders(initial = {}) {
  const headers =
    new Headers(initial);

  if (bypass) {
    headers.set(
      "x-vercel-protection-bypass",
      bypass,
    );
  }

  return headers;
}

async function timedFetch(input, init = {}) {
  return fetch(input, {
    ...init,
    cache: "no-store",
    headers: protectedHeaders(init.headers),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function timedNeonFetch(input, init = {}) {
  return fetch(input, {
    ...init,
    cache: "no-store",
    headers: new Headers(init.headers),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function jsonBody(response) {
  const type =
    response.headers.get("content-type")
    ?? "";

  assert.match(
    type,
    /application\/json/i,
    `Expected JSON, got ${type || "<empty>"} at HTTP ${response.status}.`,
  );

  return response.json();
}

function deploymentUrl(pathname) {
  return new URL(pathname, deployment);
}

function neonUrl(pathname) {
  const base =
    neonDataApiUrl.endsWith("/")
      ? neonDataApiUrl
      : `${neonDataApiUrl}/`;

  return new URL(
    pathname.replace(/^\/+/u, ""),
    base,
  );
}

function requestFailure(error) {
  return error?.name === "TimeoutError"
    ? "TIMEOUT"
    : "TRANSPORT_ERROR";
}

const auth =
  createClient(
    supabaseUrl,
    publishableKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        fetch: timedSupabaseFetch,
      },
    },
  );

const {
  data,
  error,
} = await auth.auth.signInWithPassword({
  email,
  password,
});

assert.equal(
  error,
  null,
  `Supabase sign-in failed: ${error?.message ?? "unknown"}`,
);
assert.ok(data.session, "Supabase Auth returned no session.");

const token =
  data.session.access_token;
const bearerHeaders = {
  Authorization: `Bearer ${token}`,
  Accept: "application/json",
};

try {
  const directCore =
    await timedNeonFetch(
      neonUrl("rpc/get_pos_bootstrap_core_v2"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: "{}",
      },
    );

  assert.equal(
    directCore.status,
    200,
    `Direct Neon V2 core returned ${directCore.status}.`,
  );

  const directCoreBody =
    await jsonBody(directCore);

  assert.equal(
    directCoreBody?.ok,
    true,
    "Direct Neon V2 core did not return ok=true.",
  );
  console.log("Direct Neon V2 core exposure: PASS");

  const missingAuth =
    await timedFetch(
      deploymentUrl("/api/pos/v2/bootstrap"),
      {
        headers: {
          Accept: "application/json",
        },
      },
    );
  assert.equal(
    missingAuth.status,
    401,
    "Missing bearer must return HTTP 401.",
  );

  const invalidAuth =
    await timedFetch(
      deploymentUrl("/api/pos/v2/bootstrap"),
      {
        headers: {
          Authorization: "Bearer eyJ.invalid.invalid",
          Accept: "application/json",
        },
      },
    );
  assert.equal(
    invalidAuth.status,
    401,
    "Invalid bearer must return HTTP 401.",
  );

  const coreResponse =
    await timedFetch(
      deploymentUrl("/api/pos/v2/bootstrap"),
      { headers: bearerHeaders },
    );
  assert.equal(
    coreResponse.status,
    200,
    `V2 core returned HTTP ${coreResponse.status}.`,
  );

  const core =
    await jsonBody(coreResponse);

  assert.equal(core?.ok, true);
  assert.equal(core?.version, 2);
  assert.equal(
    typeof core?.core?.organization?.id,
    "string",
  );
  assert.equal(
    typeof core?.core?.employee?.id,
    "string",
  );

  const organizationId =
    core.core.organization.id;
  const activeShift =
    core.core.activeShift;

  console.log("Deployed V2 core: PASS");

  const foreignOrganization =
    randomUUID();
  const crossTenant =
    await timedFetch(
      deploymentUrl("/api/pos/v2/bootstrap"),
      {
        headers: {
          ...bearerHeaders,
          "X-Tindio-Organization-Id": foreignOrganization,
        },
      },
    );
  assert.equal(
    crossTenant.status,
    403,
    `Cross-tenant V2 core expected 403, got ${crossTenant.status}.`,
  );

  const foreignReference =
    await timedFetch(
      deploymentUrl("/api/pos/v2/reference"),
      {
        headers: {
          ...bearerHeaders,
          "X-Tindio-Organization-Id": foreignOrganization,
        },
      },
    );
  assert.equal(
    foreignReference.status,
    403,
    `Cross-tenant V2 reference expected 403, got ${foreignReference.status}.`,
  );

  async function fetchReference() {
    const response =
      await timedFetch(
        deploymentUrl("/api/pos/v2/reference"),
        {
          headers: {
            ...bearerHeaders,
            "X-Tindio-Organization-Id": organizationId,
          },
        },
      );

    assert.equal(
      response.status,
      200,
      `V2 reference returned HTTP ${response.status}.`,
    );

    const body =
      await jsonBody(response);

    assert.equal(body?.ok, true);
    assert.equal(body?.version, 2);
    assert.equal(
      typeof body?.referenceVersion,
      "string",
    );

    return { response, body };
  }

  const referenceOne =
    await fetchReference();
  const referenceTwo =
    await fetchReference();

  assert.equal(
    referenceTwo.body.referenceVersion,
    referenceOne.body.referenceVersion,
    "Reference version was not deterministic.",
  );
  assert.equal(
    referenceOne.response.headers.get(
      "x-tindio-reference-version",
    ),
    referenceOne.body.referenceVersion,
    "Reference version header mismatch.",
  );
  console.log("Deployed V2 reference + deterministic version: PASS");

  const liveHeaders = {
    ...bearerHeaders,
    "X-Tindio-Organization-Id": organizationId,
    ...(activeShift?.storeId
      ? {
          "X-Tindio-Store-Id": activeShift.storeId,
        }
      : {}),
    ...(activeShift?.registerId
      ? {
          "X-Tindio-Register-Id": activeShift.registerId,
        }
      : {}),
  };
  const liveResponse =
    await timedFetch(
      deploymentUrl("/api/pos/v2/live"),
      { headers: liveHeaders },
    );
  assert.equal(
    liveResponse.status,
    200,
    `V2 live returned HTTP ${liveResponse.status}.`,
  );
  const live =
    await jsonBody(liveResponse);
  assert.equal(live?.ok, true);

  const badRegister =
    await timedFetch(
      deploymentUrl("/api/pos/v2/live"),
      {
        headers: {
          ...bearerHeaders,
          "X-Tindio-Organization-Id": organizationId,
          ...(activeShift?.storeId
            ? {
                "X-Tindio-Store-Id": activeShift.storeId,
              }
            : {}),
          "X-Tindio-Register-Id": randomUUID(),
        },
      },
    );
  assert.equal(
    badRegister.status,
    403,
    `Foreign register expected 403, got ${badRegister.status}.`,
  );
  console.log("Deployed V2 live + register isolation: PASS");

  if (
    !activeShift?.storeId
    || !activeShift?.registerId
  ) {
    throw new Error(
      "FINAL_CERTIFICATION_BLOCKED_NO_ACTIVE_SHIFT: Open a dedicated PREPRODUCTION test shift through the POS UI, then rerun Phase 04F certification.",
    );
  }

  const activeStoreId =
    activeShift.storeId;
  const crossStore =
    await timedFetch(
      deploymentUrl(
        `/api/pos/v2/catalog?store=${encodeURIComponent(randomUUID())}&mode=search&offset=0&limit=24`,
      ),
      {
        headers: {
          ...bearerHeaders,
          "X-Tindio-Organization-Id": organizationId,
        },
      },
    );
  assert.equal(
    crossStore.status,
    403,
    `Foreign store catalog expected 403, got ${crossStore.status}.`,
  );

  async function catalog(mode, extra = "") {
    const response =
      await timedFetch(
        deploymentUrl(
          `/api/pos/v2/catalog?store=${encodeURIComponent(activeStoreId)}&mode=${encodeURIComponent(mode)}&offset=0&limit=24${extra}`,
        ),
        {
          headers: {
            ...bearerHeaders,
            "X-Tindio-Organization-Id": organizationId,
          },
        },
      );
    assert.equal(
      response.status,
      200,
      `Catalog mode ${mode} returned HTTP ${response.status}.`,
    );
    const body =
      await jsonBody(response);
    assert.equal(body?.ok, true);
    assert.ok(Array.isArray(body?.items));
    return body;
  }

  const searchCatalog =
    await catalog("search");
  await catalog("favorites");
  await catalog("recent");

  if (referenceOne.body?.reference?.categories?.length) {
    const categoryId =
      referenceOne.body.reference.categories[0]?.id;

    if (typeof categoryId === "string") {
      await catalog(
        "search",
        `&category=${encodeURIComponent(categoryId)}`,
      );
    }
  }

  if (searchCatalog.hasMore) {
    const pageTwo =
      await timedFetch(
        deploymentUrl(
          `/api/pos/v2/catalog?store=${encodeURIComponent(activeStoreId)}&mode=search&offset=24&limit=24`,
        ),
        {
          headers: {
            ...bearerHeaders,
            "X-Tindio-Organization-Id": organizationId,
          },
        },
      );
    assert.equal(
      pageTwo.status,
      200,
      "Catalog pagination page 2 failed.",
    );
    await pageTwo.arrayBuffer();
  }
  console.log("Deployed V2 catalog modes/pagination/scope: PASS");

  if (searchCatalog.items.length === 0) {
    throw new Error(
      "FINAL_CERTIFICATION_BLOCKED_EMPTY_CATALOG: The PREPRODUCTION test store needs at least one catalog item.",
    );
  }

  const productId =
    searchCatalog.items[0].productId;
  const modifiersResponse =
    await timedFetch(
      deploymentUrl(
        `/api/pos/v2/modifiers?store=${encodeURIComponent(activeStoreId)}&product=${encodeURIComponent(productId)}`,
      ),
      {
        headers: {
          ...bearerHeaders,
          "X-Tindio-Organization-Id": organizationId,
        },
      },
    );
  assert.equal(
    modifiersResponse.status,
    200,
    `V2 modifiers returned HTTP ${modifiersResponse.status}.`,
  );
  const modifiers =
    await jsonBody(modifiersResponse);
  assert.equal(modifiers?.ok, true);
  assert.ok(Array.isArray(modifiers?.groups));
  assert.ok(
    modifiers.groups.every(
      (group) =>
        group
        && typeof group.id === "string"
        && typeof group.name === "string"
        && Number.isInteger(group.minSelections)
        && Number.isInteger(group.maxSelections)
        && Array.isArray(group.options)
        && group.options.every(
          (option) =>
            option
            && typeof option.id === "string"
            && typeof option.name === "string"
            && Number.isFinite(option.priceMinor),
        ),
    ),
    "V2 modifier groups are not structurally valid.",
  );
  console.log("Deployed V2 modifiers: PASS");

  async function runSequential(label, count, request) {
    const statusCounts = {};
    const failures = [];

    for (
      let index = 1;
      index <= count;
      index += 1
    ) {
      try {
        const response =
          await request();
        const status =
          String(response.status);
        statusCounts[status] =
          (statusCounts[status] ?? 0) + 1;

        if (response.status !== 200) {
          failures.push({
            index,
            status: response.status,
            requestId: response.headers.get(
              "x-tindio-request-id",
            ),
          });
        }

        await response.arrayBuffer().catch(() => null);
      } catch (requestError) {
        failures.push({
          index,
          status: requestFailure(requestError),
        });
      }

      if (index % 25 === 0) {
        console.log(`${label}: ${index}/${count}`);
      }
    }

    console.log(
      `${label} distribution:`,
      JSON.stringify(statusCounts),
    );
    assert.equal(
      failures.length,
      0,
      `${label} failures: ${JSON.stringify(failures.slice(0, 10))}`,
    );
  }

  await runSequential(
    "Core sequential stability",
    200,
    () => timedFetch(
      deploymentUrl("/api/pos/v2/bootstrap"),
      { headers: bearerHeaders },
    ),
  );
  await runSequential(
    "Reference sequential stability",
    50,
    () => timedFetch(
      deploymentUrl("/api/pos/v2/reference"),
      {
        headers: {
          ...bearerHeaders,
          "X-Tindio-Organization-Id": organizationId,
        },
      },
    ),
  );
  await runSequential(
    "Live sequential stability",
    50,
    () => timedFetch(
      deploymentUrl("/api/pos/v2/live"),
      { headers: liveHeaders },
    ),
  );
  await runSequential(
    "Catalog sequential stability",
    50,
    () => timedFetch(
      deploymentUrl(
        `/api/pos/v2/catalog?store=${encodeURIComponent(activeStoreId)}&mode=search&offset=0&limit=24`,
      ),
      {
        headers: {
          ...bearerHeaders,
          "X-Tindio-Organization-Id": organizationId,
        },
      },
    ),
  );
  await runSequential(
    "Modifiers sequential stability",
    50,
    () => timedFetch(
      deploymentUrl(
        `/api/pos/v2/modifiers?store=${encodeURIComponent(activeStoreId)}&product=${encodeURIComponent(productId)}`,
      ),
      {
        headers: {
          ...bearerHeaders,
          "X-Tindio-Organization-Id": organizationId,
        },
      },
    ),
  );

  const mixedRequests = [
    () => timedFetch(
      deploymentUrl("/api/pos/v2/bootstrap"),
      { headers: bearerHeaders },
    ),
    () => timedFetch(
      deploymentUrl("/api/pos/v2/reference"),
      {
        headers: {
          ...bearerHeaders,
          "X-Tindio-Organization-Id": organizationId,
        },
      },
    ),
    () => timedFetch(
      deploymentUrl("/api/pos/v2/live"),
      { headers: liveHeaders },
    ),
    () => timedFetch(
      deploymentUrl(
        `/api/pos/v2/catalog?store=${encodeURIComponent(activeStoreId)}&mode=search&offset=0&limit=24`,
      ),
      {
        headers: {
          ...bearerHeaders,
          "X-Tindio-Organization-Id": organizationId,
        },
      },
    ),
    () => timedFetch(
      deploymentUrl(
        `/api/pos/v2/modifiers?store=${encodeURIComponent(activeStoreId)}&product=${encodeURIComponent(productId)}`,
      ),
      {
        headers: {
          ...bearerHeaders,
          "X-Tindio-Organization-Id": organizationId,
        },
      },
    ),
  ];
  const mixedFailures = [];

  for (
    let wave = 1;
    wave <= 20;
    wave += 1
  ) {
    const responses =
      await Promise.allSettled(
        mixedRequests.map((request) => request()),
      );

    for (const [index, result] of responses.entries()) {
      if (result.status === "rejected") {
        mixedFailures.push({
          wave,
          endpoint: index,
          status: requestFailure(result.reason),
        });
        continue;
      }

      if (result.value.status !== 200) {
        mixedFailures.push({
          wave,
          endpoint: index,
          status: result.value.status,
          requestId: result.value.headers.get(
            "x-tindio-request-id",
          ),
        });
      }

      await result.value.arrayBuffer().catch(() => null);
    }

    console.log(`Mixed concurrency: ${wave}/20 waves`);
    await sleep(100);
  }

  assert.equal(
    mixedFailures.length,
    0,
    `Mixed concurrency failures: ${JSON.stringify(mixedFailures.slice(0, 20))}`,
  );
  console.log("Sequential V2 reliability: PASS 400/400");
  console.log("Mixed 5-endpoint concurrency: PASS 100/100");
  console.log("Final V2 API reliability: PASS 500/500");
  console.log(
    bypass
      ? "Vercel protection bypass: ACTIVE"
      : "Vercel protection bypass: NOT REQUIRED",
  );
  console.log("PHASE 04F V2 FINAL DEPLOYED API CERTIFICATION: PASS");
} finally {
  await auth.auth.signOut().catch(() => null);
}
