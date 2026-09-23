import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";
import test from "node:test";

const packageJson =
  JSON.parse(
    await readFile(
      new URL(
        "../package.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

const certifier =
  await readFile(
    new URL(
      "./certify-repository.mjs",
      import.meta.url,
    ),
    "utf8",
  );

const gitignore =
  await readFile(
    new URL(
      "../.gitignore",
      import.meta.url,
    ),
    "utf8",
  );

const phase14Runner =
  await readFile(
    new URL(
      "./phase-14-playwright-run.mjs",
      import.meta.url,
    ),
    "utf8",
  );

test(
  "obsolete remote-Supabase Phase 04 cutover prerequisite is not an automated package test",
  () => {
    assert.equal(
      Object.hasOwn(
        packageJson.scripts ?? {},
        "test:phase-04-cutover-prerequisites",
      ),
      false,
    );
  },
);

test(
  "hosted Supabase JWKS verification is explicitly classified as manual integration",
  () => {
    assert.match(
      certifier,
      /MANUAL_INTEGRATION_TESTS[\s\S]*["']test:phase-04-supabase-jwks["']/,
    );
  },
);

test(
  "Phase 14 remains automated but runs only after clean local database replay",
  () => {
    assert.ok(
      Object.hasOwn(
        packageJson.scripts ?? {},
        "test:phase-14-browser",
      ),
    );

    assert.match(
      certifier,
      /LOCAL_DATABASE_INTEGRATION_TESTS[\s\S]*["']test:phase-14-browser["']/,
    );

    const manualSetMatch =
      certifier.match(
        /const MANUAL_INTEGRATION_TESTS[\s\S]*?\]\);/,
      );

    assert.ok(
      manualSetMatch,
      "Unable to locate MANUAL_INTEGRATION_TESTS.",
    );

    assert.doesNotMatch(
      manualSetMatch[0],
      /["']test:phase-14-browser["']/,
    );

    const databaseCertification =
      certifier.slice(
        certifier.indexOf(
          "async function runDatabaseCertification()",
        ),
      );

    const replayIndex =
      databaseCertification.indexOf(
        '"Clean local migration replay"',
      );

    const integrationIndex =
      databaseCertification.indexOf(
        "localDatabaseIntegrationTests",
        replayIndex,
      );

    assert.ok(
      replayIndex >= 0,
      "Unable to locate clean local migration replay.",
    );

    assert.ok(
      integrationIndex >= 0,
      "Unable to locate local database integration execution.",
    );

    assert.ok(
      replayIndex < integrationIndex,
      "Phase 14 integration must run after clean local migration replay.",
    );
  },
);

test(
  "Playwright result artifacts are ignored",
  () => {
    assert.match(
      gitignore,
      /^\/test-results\/$/m,
    );
  },
);

test(
  "Phase 14 browser certification explicitly forces the local Supabase database provider",
  () => {
    assert.match(
      phase14Runner,
      /TINDIO_DATABASE_PROVIDER\s*:\s*["']supabase["']/,
    );

    assert.match(
      phase14Runner,
      /NEXT_PUBLIC_SUPABASE_URL\s*:\s*apiUrl/,
    );

    assert.match(
      phase14Runner,
      /TINDIO_E2E_SUPABASE_URL\s*:\s*apiUrl/,
    );
  },
);
