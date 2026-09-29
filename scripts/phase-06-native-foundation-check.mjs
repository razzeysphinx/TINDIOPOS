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

  assert.ok(
    read("pnpm-workspace.yaml")
      .includes("apps/*"),
  );

  assert.ok(
    read("tsconfig.json")
      .includes("apps/mobile"),
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
      "/api/pos/v2/bootstrap",
      "Authorization",
      "Bearer",
      "x-tindio-organization-id",
      "import type",
      "PosBootstrapV2CoreResponse",
    ]
  ) {
    assert.ok(
      source.includes(
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

  assert.equal(
    secureStorage.includes("::"),
    false,
    "Expo SecureStore keys must use only supported key characters.",
  );

  assert.ok(
    secureStorage.includes(".__chunks"),
  );

  assert.ok(
    secureStorage.includes("chunkKey"),
  );
});
