import assert from "node:assert/strict";
import {
  execFileSync,
} from "node:child_process";
import {
  readFile,
} from "node:fs/promises";
import test from "node:test";

const BASE_SHA =
  "70a5ae7e063cc7402d0a10231a7ffc264511bbeb";

const PHASE_FINAL_SHA =
  "494191999463ba7a34130051344e4b8819c83a43";

async function source(path) {
  return readFile(
    new URL(
      `../${path}`,
      import.meta.url,
    ),
    "utf8",
  );
}

const [
  dal,
  posV2CoreContext,
  posV2BusinessContext,
  contextClient,
  bootstrap,
  workflow,
  packageText,
] = await Promise.all([
  source("src/lib/auth/dal.ts"),
  source("src/lib/auth/pos-v2-context.ts"),
  source("src/lib/auth/pos-v2-business-context.ts"),
  source(
    "src/lib/supabase/context-client.ts",
  ),
  source(
    "src/app/api/pos/v2/bootstrap/route.ts",
  ),
  source(
    ".github/workflows/tindio-baseline-certification.yml",
  ),
  source("package.json"),
]);

const packageJson =
  JSON.parse(packageText);

const contextClientFiles = [
  "src/features/checkout/checkout-service.ts",
  "src/features/pos/data.ts",
  "src/features/pos/service.ts",
  "src/features/customers/service.ts",
  "src/features/shifts/service.ts",
  "src/features/advanced-sales/ticket-service.ts",
  "src/features/receipts/service.ts",
  "src/features/inventory/pos-transfer-service.ts",
  "src/features/approvals/service.ts",
  "src/features/time-clock/service.ts",
  "src/features/time-clock/data.ts",
  "src/app/api/pos/v2/customers/route.ts",
  "src/app/api/pos/v2/customer-display/route.ts",
  "src/app/api/pos/v2/device/route.ts",
  "src/app/api/pos/v2/offline-checkout/route.ts",
];

test(
  "BusinessContext carries transport metadata and one shared resolver",
  () => {
    assert.match(
      dal,
      /export type BusinessRequestAuth/,
    );

    assert.match(
      dal,
      /requestAuth:\s*BusinessRequestAuth/,
    );

    assert.match(
      dal,
      /export async function loadBusinessContext/,
    );

    assert.match(
      dal,
      /export async function resolveVerifiedUser/,
    );

    assert.match(
      dal,
      /strictRequestedOrganization/,
    );

    assert.match(
      dal,
      /strictRequestedOrganization[\s\S]*requestedOrganizationId[\s\S]*!requestedOrganization[\s\S]*return null/,
    );

    assert.match(
      dal,
      /getBusinessContext = cache/,
    );
  },
);

test(
  "V2 bearer authentication is verified and never falls back to cookies",
  () => {
    assert.match(
      posV2CoreContext,
      /request\.headers\.get\("authorization"\)/,
    );

    assert.match(
      posV2CoreContext,
      /authClient\.auth\.getClaims/,
    );

    assert.match(
      posV2CoreContext,
      /if \(!token\)[\s\S]*status: 401/,
    );

    assert.match(
      posV2CoreContext,
      /AUTH_INVALID/,
    );

    assert.match(
      posV2CoreContext,
      /claims\.sub/,
    );

    assert.match(
      posV2CoreContext,
      /authClient\.auth\.getClaims\(\s*token,?\s*\)/,
    );

    assert.match(
      posV2CoreContext,
      /try\s*\{[\s\S]*authClient\.auth\.getClaims/,
    );

    assert.match(
      posV2CoreContext,
      /catch \(error\)[\s\S]*AUTH_PROVIDER_UNAVAILABLE/,
    );

    assert.match(
      posV2BusinessContext,
      /getPosV2Core/,
    );

    assert.match(
      posV2BusinessContext,
      /requestAuth:[\s\S]*transport:[\s\S]*"bearer"/,
    );
  },
);

test(
  "explicit mobile organization selection is strict and request scoped",
  () => {
    assert.match(
      posV2CoreContext,
      /POS_V2_ORGANIZATION_HEADER/,
    );

    assert.match(
      posV2CoreContext,
      /uuidSchema\.safeParse/,
    );

    assert.match(
      posV2CoreContext,
      /target_organization_id/,
    );
  },
);

test(
  "context client propagates bearer identity and prevents caller override",
  () => {
    assert.match(
      contextClient,
      /createBusinessContextClient/,
    );

    assert.match(
      contextClient,
      /name\.toLowerCase\(\)[\s\S]*!== "authorization"/,
    );

    assert.match(
      contextClient,
      /context\.requestAuth\.transport[\s\S]*=== "bearer"/,
    );

    assert.match(
      contextClient,
      /headers\.Authorization[\s\S]*authorizationHeader/,
    );
  },
);

test(
  "all Phase 01 POS database paths use the authenticated context client",
  async () => {
    for (
      const path
      of contextClientFiles
    ) {
      const content =
        await source(path);

      assert.match(
        content,
        /createBusinessContextClient/,
        `${path} does not use the authenticated BusinessContext client`,
      );

      assert.doesNotMatch(
        content,
        /@\/lib\/supabase\/server/,
        `${path} still creates a cookie-only Supabase client`,
      );
    }
  },
);

test(
  "bootstrap exposes only a client-safe V2 Core response",
  () => {
    assert.match(
      bootstrap,
      /version: 2/,
    );

    assert.match(
      bootstrap,
      /core:[\s\S]*result\.core/,
    );

    assert.doesNotMatch(
      bootstrap,
      /authorizationHeader|requestAuth|subject:/,
    );
  },
);

test(
  "production mobile auth paths contain no service-role secret",
  async () => {
    const paths = [
      "src/lib/auth/pos-v2-context.ts",
      "src/lib/auth/pos-v2-business-context.ts",
      "src/lib/supabase/context-client.ts",
      "src/app/api/pos/v2/bootstrap/route.ts",
      ...contextClientFiles,
    ];

    for (
      const path
      of paths
    ) {
      const content =
        await source(path);

      assert.doesNotMatch(
        content,
        /service[_-]?role|SERVICE_ROLE|SECRET_KEY/i,
        `${path} contains privileged server credentials`,
      );
    }
  },
);

test(
  "Phase 02 adds no database migration or generated type drift",
  () => {
    const committedMigrations =
      execFileSync(
        "git",
        [
          "diff",
          "--name-only",
          `${BASE_SHA}...${PHASE_FINAL_SHA}`,
          "--",
          "supabase/migrations",
        ],
        {
          encoding: "utf8",
        },
      ).trim();

    const dirtyMigrations =
      execFileSync(
        "git",
        [
          "status",
          "--porcelain",
          "--",
          "supabase/migrations",
        ],
        {
          encoding: "utf8",
        },
      ).trim();

    const committedTypes =
      execFileSync(
        "git",
        [
          "diff",
          "--name-only",
          `${BASE_SHA}...${PHASE_FINAL_SHA}`,
          "--",
          "src/lib/supabase/database.types.ts",
        ],
        {
          encoding: "utf8",
        },
      ).trim();

    const dirtyTypes =
      execFileSync(
        "git",
        [
          "status",
          "--porcelain",
          "--",
          "src/lib/supabase/database.types.ts",
        ],
        {
          encoding: "utf8",
        },
      ).trim();

    assert.equal(
      committedMigrations,
      "",
    );

    assert.equal(
      dirtyMigrations,
      "",
    );

    assert.equal(
      committedTypes,
      "",
    );

    assert.equal(
      dirtyTypes,
      "",
    );
  },
);

test(
  "Phase 01 and Source-of-Truth contracts remain active",
  () => {
    assert.equal(
      packageJson.scripts[
        "test:phase-01-pos-api-contract"
      ],
      "node --test scripts/phase-01-pos-api-contract-check.mjs",
    );

    assert.equal(
      packageJson.scripts[
        "test:mobile-source-of-truth"
      ],
      "node --test scripts/mobile-program-source-of-truth-check.mjs",
    );

    assert.equal(
      packageJson.scripts[
        "test:phase-02-mobile-auth-contract"
      ],
      "node --test scripts/phase-02-mobile-auth-contract-check.mjs",
    );

    assert.equal(
      packageJson.scripts[
        "certify:phase-02:bearer-auth"
      ],
      "node scripts/phase-02-bearer-auth-e2e.mjs",
    );

    assert.match(
      workflow,
      /Run Phase 02 bearer-auth certification/,
    );

    assert.match(
      workflow,
      /pnpm certify:phase-02:bearer-auth/,
    );
  },
);
