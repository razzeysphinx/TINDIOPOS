import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file) =>
  fs.readFileSync(
    path.join(process.cwd(), file),
    "utf8",
  );

test("Phase 06 native foundation boundary", () => {
  const pkg = JSON.parse(
    read("apps/mobile/package.json"),
  );

  assert.equal(
    pkg.name,
    "@tindio/mobile",
  );

  for (
    const dependency
    of [
      "expo",
      "react-native",
      "expo-router",
      "expo-secure-store",
      "@supabase/supabase-js",
    ]
  ) {
    assert.ok(
      pkg.dependencies[
        dependency
      ],
    );
  }

  assert.match(
    read("pnpm-workspace.yaml"),
    /apps/*/,
  );

  assert.match(
    read("tsconfig.json"),
    /apps/mobile/,
  );

  const source =
    read(
      "apps/mobile/src/lib/tindio-api.ts",
    )
    + read(
      "apps/mobile/src/features/business/use-business-context.ts",
    );

  for (
    const token
    of [
      "\/api\/pos\/v2\/bootstrap",
      "Authorization",
      "Bearer",
      "x-tindio-organization-id",
      "import type",
      "PosBootstrapV2CoreResponse",
    ]
  ) {
    assert.match(
      source,
      new RegExp(
        token,
      ),
    );
  }

  for (
    const secret
    of [
      "DATABASE_URL",
      "NEON_DATA_API_URL",
      "service_role",
      "SUPABASE_SERVICE_ROLE",
      "x-vercel-protection-bypass",
    ]
  ) {
    assert.ok(
      !source.includes(
        secret,
      ),
    );
  }

  const secureStorage =
    read(
      "apps/mobile/src/lib/secure-storage.ts",
    );

  assert.doesNotMatch(
    secureStorage,
    /::/,
    "Expo SecureStore keys must use only supported key characters.",
  );

  assert.match(
    secureStorage,
    /\.__chunks/,
  );

  assert.match(
    secureStorage,
    /\.__\$\{index\}/,
  );
});
