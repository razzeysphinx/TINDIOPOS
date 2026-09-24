import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import {
  createClient,
} from "@supabase/supabase-js";

import {
  createOwnerBusiness,
  createScopedEmployee,
  newContext,
  phase14Password,
} from "../phase-14/fixtures";

test.describe.configure({
  mode: "serial",
});

const appUrl =
  "http://127.0.0.1:3100";

const apiUrl =
  process.env
    .TINDIO_E2E_SUPABASE_URL;

const publishableKey =
  process.env
    .TINDIO_E2E_SUPABASE_PUBLISHABLE_KEY;

if (
  !apiUrl
  || !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/i
    .test(apiUrl)
) {
  throw new Error(
    "Phase 02 refuses a non-local Supabase URL.",
  );
}

if (!publishableKey) {
  throw new Error(
    "Phase 02 requires the local Supabase publishable key.",
  );
}

const runLabel =
  process.env
    .TINDIO_E2E_RUN_ID
  ?? Date.now().toString();

const suffix =
  runLabel
    .replaceAll(/[^A-Za-z0-9]/g, "")
    .slice(-8);

const businessAName =
  `Phase 02 Business A ${runLabel}`;

const businessBName =
  `Phase 02 Business B ${runLabel}`;

const storeAName =
  `Phase 02 Store A ${runLabel}`;

const storeBName =
  `Phase 02 Store B ${runLabel}`;

const ownerAEmail =
  `phase02-owner-a-${suffix}@tindio.local`;

const ownerBEmail =
  `phase02-owner-b-${suffix}@tindio.local`;

const scopedEmail =
  `phase02-scoped-${suffix}@tindio.local`;

let ownerAContext:
  BrowserContext;

let ownerBContext:
  BrowserContext;

let ownerAPage:
  Page;

let ownerBPage:
  Page;

let organizationAId = "";
let organizationBId = "";
let storeAId = "";
let storeBId = "";

let ownerAToken = "";
let scopedToken = "";

function createUserClient() {
  return createClient(
    apiUrl!,
    publishableKey!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

async function signIn(
  email: string,
) {
  const client =
    createUserClient();

  const {
    data,
    error,
  } =
    await client.auth
      .signInWithPassword({
        email,
        password:
          phase14Password,
      });

  if (
    error
    || !data.session
  ) {
    throw new Error(
      `Unable to authenticate ${email}: ${error?.message ?? "missing session"}`,
    );
  }

  return {
    client,
    accessToken:
      data.session.access_token,
  };
}

async function bearerFetch(
  path: string,
  accessToken: string,
  organizationId?: string,
) {
  const headers =
    new Headers();

  headers.set(
    "Authorization",
    `Bearer ${accessToken}`,
  );

  if (organizationId) {
    headers.set(
      "X-Tindio-Organization-Id",
      organizationId,
    );
  }

  return fetch(
    `${appUrl}${path}`,
    {
      headers,
    },
  );
}

test.beforeAll(
  async ({
    browser,
  }) => {
    ownerAContext =
      await newContext(browser);

    ownerBContext =
      await newContext(browser);

    ownerAPage =
      await ownerAContext.newPage();

    ownerBPage =
      await ownerBContext.newPage();

    await createOwnerBusiness(
      ownerAPage,
      {
        email:
          ownerAEmail,
        businessName:
          businessAName,
        storeName:
          storeAName,
        registerName:
          `Phase 02 Register A ${runLabel}`,
      },
    );

    await createOwnerBusiness(
      ownerBPage,
      {
        email:
          ownerBEmail,
        businessName:
          businessBName,
        storeName:
          `Phase 02 Business B Store ${runLabel}`,
        registerName:
          `Phase 02 Register B ${runLabel}`,
      },
    );

    const ownerA =
      await signIn(
        ownerAEmail,
      );

    ownerAToken =
      ownerA.accessToken;

    const {
      data: organizationA,
      error: organizationAError,
    } =
      await ownerA.client
        .from("organizations")
        .select("id")
        .eq(
          "name",
          businessAName,
        )
        .single();

    if (
      organizationAError
      || !organizationA
    ) {
      throw new Error(
        `Unable to resolve Business A: ${organizationAError?.message ?? "missing"}`,
      );
    }

    organizationAId =
      organizationA.id;

    const {
      data: storeA,
      error: storeAError,
    } =
      await ownerA.client
        .from("stores")
        .select("id")
        .eq(
          "organization_id",
          organizationAId,
        )
        .eq(
          "name",
          storeAName,
        )
        .single();

    if (
      storeAError
      || !storeA
    ) {
      throw new Error(
        `Unable to resolve Store A: ${storeAError?.message ?? "missing"}`,
      );
    }

    storeAId =
      storeA.id;

    const {
      data: storeB,
      error: storeBError,
    } =
      await ownerA.client
        .from("stores")
        .insert({
          organization_id:
            organizationAId,
          name:
            storeBName,
          code:
            `P2B${suffix}`.slice(
              0,
              20,
            ),
          is_active: true,
        })
        .select("id")
        .single();

    if (
      storeBError
      || !storeB
    ) {
      throw new Error(
        `Unable to create Store B fixture: ${storeBError?.message ?? "missing"}`,
      );
    }

    storeBId =
      storeB.id;

    const ownerB =
      await signIn(
        ownerBEmail,
      );

    const {
      data: organizationB,
      error: organizationBError,
    } =
      await ownerB.client
        .from("organizations")
        .select("id")
        .eq(
          "name",
          businessBName,
        )
        .single();

    if (
      organizationBError
      || !organizationB
    ) {
      throw new Error(
        `Unable to resolve Business B: ${organizationBError?.message ?? "missing"}`,
      );
    }

    organizationBId =
      organizationB.id;

    await createScopedEmployee({
      email:
        scopedEmail,

      ownerEmail:
        ownerAEmail,

      organizationName:
        businessAName,

      permissionCodes: [
        "pos.access",
        "sales.create",
      ],

      storeName:
        storeAName,
    });

    const scoped =
      await signIn(
        scopedEmail,
      );

    scopedToken =
      scoped.accessToken;
  },
);

test.afterAll(
  async () => {
    await ownerAContext.close();
    await ownerBContext.close();
  },
);

test(
  "P02-AUTH-01 web cookie authentication remains compatible outside bearer-only V2 APIs",
  async () => {
    const response =
      await ownerAContext
        .request
        .get(
          `${appUrl}/back-office`,
        );

    expect(
      response.status(),
    ).toBe(200);

    const body =
      await response.text();

    expect(
      body,
    ).toContain(
      businessAName,
    );
  },
);

test(
  "P02-AUTH-02 valid bearer authentication works without cookies",
  async () => {
    const response =
      await bearerFetch(
        "/api/pos/v2/bootstrap",
        ownerAToken,
        organizationAId,
      );

    expect(
      response.status,
    ).toBe(200);

    const body =
      await response.json() as {
        core: {
          organization: {
            id: string;
          };
        };
      };

    expect(
      body.core.organization.id,
    ).toBe(
      organizationAId,
    );
  },
);

test(
  "P02-AUTH-03 invalid bearer never falls back to a valid cookie",
  async () => {
    const response =
      await ownerAContext
        .request
        .get(
          `${appUrl}/api/pos/v2/bootstrap`,
          {
            headers: {
              Authorization:
                "Bearer invalid.invalid.invalid",
            },
          },
        );

    expect(
      response.status(),
    ).toBe(401);
  },
);

test(
  "P02-AUTH-04 foreign organization header fails closed",
  async () => {
    const response =
      await bearerFetch(
        "/api/pos/v2/bootstrap",
        ownerAToken,
        organizationBId,
      );

    expect(
      response.status,
    ).toBe(403);

    const text =
      await response.text();

    expect(text).not.toContain(
      businessBName,
    );
  },
);

test(
  "P02-AUTH-05 malformed organization header fails closed",
  async () => {
    const response =
      await fetch(
        `${appUrl}/api/pos/v2/bootstrap`,
        {
          headers: {
            Authorization:
              `Bearer ${ownerAToken}`,

            "X-Tindio-Organization-Id":
              "not-a-uuid",
          },
        },
      );

    expect(
      response.status,
    ).toBe(403);
  },
);

test(
  "P02-AUTH-06 malformed authorization headers never use cookie fallback",
  async () => {
    const values = [
      "Basic abc123",
      "Bearer",
      "Bearer token with spaces",
    ];

    for (
      const authorization
      of values
    ) {
      const response =
        await ownerAContext
          .request
          .get(
            `${appUrl}/api/pos/v2/bootstrap`,
            {
              headers: {
                Authorization:
                  authorization,
              },
            },
          );

      expect(
        response.status(),
      ).toBe(401);
    }
  },
);

test(
  "P02-AUTH-07 scoped employee sees only assigned store and cannot request Store B catalog",
  async () => {
    const bootstrapResponse =
      await bearerFetch(
        "/api/pos/v2/bootstrap",
        scopedToken,
        organizationAId,
      );

    expect(
      bootstrapResponse.status,
    ).toBe(200);

    const bootstrap =
      await bootstrapResponse.json() as {
        core: {
          stores: Array<{
            id: string;
          }>;
        };
      };

    const storeIds =
      bootstrap.core
        .stores
        .map(
          (store) => store.id,
        );

    expect(storeIds).toContain(
      storeAId,
    );

    expect(storeIds).not.toContain(
      storeBId,
    );

    const catalogResponse =
      await bearerFetch(
        `/api/pos/v2/catalog?store=${encodeURIComponent(storeBId)}`,
        scopedToken,
        organizationAId,
      );

    expect(
      catalogResponse.status,
    ).toBe(403);
  },
);

test(
  "P02-AUTH-08 organization list contains only authorized memberships",
  async () => {
    const response =
      await bearerFetch(
        "/api/pos/v2/bootstrap",
        ownerAToken,
        organizationAId,
      );

    expect(
      response.status,
    ).toBe(200);

    const body =
      await response.json() as {
        core: {
          availableOrganizations:
            Array<{
              id: string;
            }>;
        };
      };

    const organizationIds =
      body.core.availableOrganizations
        .map(
          (organization) =>
            organization.id,
        );

    expect(
      organizationIds,
    ).toContain(
      organizationAId,
    );

    expect(
      organizationIds,
    ).not.toContain(
      organizationBId,
    );
  },
);
