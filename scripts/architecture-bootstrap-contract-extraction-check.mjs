import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shared business type retains the supported values and guard", async () => {
  const contract = await read("packages/contracts/src/business.ts");

  for (const value of [
    "retail",
    "grocery",
    "convenience_store",
    "restaurant_cafe",
    "bar",
    "wholesale",
    "service",
    "other",
  ]) {
    assert.match(contract, new RegExp(`"${value}"`));
  }

  assert.match(contract, /export type BusinessType/);
  assert.match(contract, /export function isBusinessType/);
  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("shared bootstrap response retains the client-safe V2 core shape", async () => {
  const contract = await read("packages/contracts/src/pos-runtime.ts");

  for (const field of [
    "profileId",
    "organization",
    "currencyCode",
    "timezone",
    "businessType",
    "deviceManagementEnabled",
    "employee",
    "employeeNumber",
    "jobTitle",
    "availableOrganizations",
    "roleNames",
    "permissions",
    "storeIds",
    "stores",
    "registers",
    "features",
    "activeShift",
  ]) {
    assert.match(contract, new RegExp(`\\b${field}\\b`));
  }

  assert.match(contract, /export type PosBootstrapV2CoreResponse/);
  assert.match(contract, /ok:\s*true/);
  assert.match(contract, /version:\s*2/);
  assert.match(contract, /status:\s*"active" \| "suspended" \| "archived"/);
  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("Web compatibility facades retain their public contract paths", async () => {
  const [posFacade, businessFacade] = await Promise.all([
    read("src/contracts/pos.ts"),
    read("src/features/business-profile/business-features.ts"),
  ]);

  assert.match(posFacade, /\bPosBootstrapV2CoreResponse\b/);
  assert.doesNotMatch(posFacade, /export type PosBootstrapV2CoreResponse\s*=/);
  assert.match(posFacade, /from ["']@tindio\/contracts["']/);
  assert.match(businessFacade, /export \{ businessTypes, isBusinessType \} from ["']@tindio\/contracts["']/);
  assert.match(businessFacade, /export type \{ BusinessType \} from ["']@tindio\/contracts["']/);
  assert.match(businessFacade, /businessTypeLabels/);
  assert.match(businessFacade, /recommendedFeatureSettings/);
});

test("Mobile bootstrap consumers import the shared package contract", async () => {
  const paths = [
    "apps/mobile/src/db/business-context-cache.ts",
    "apps/mobile/src/features/business/business-context-provider.tsx",
    "apps/mobile/src/features/device/device-setup.tsx",
    "apps/mobile/src/features/offline/offline-readiness.ts",
    "apps/mobile/src/features/offline/renew-offline-authorization.ts",
    "apps/mobile/src/features/outbox/outbox-recovery.ts",
    "apps/mobile/src/lib/tindio-api.ts",
  ];

  for (const source of await Promise.all(paths.map(read))) {
    assert.match(
      source,
      /PosBootstrapV2CoreResponse,[\s\S]*?from ["']@tindio\/contracts["']|import type \{ PosBootstrapV2CoreResponse \} from ["']@tindio\/contracts["']/,
    );

    const rootImports = [...source.matchAll(/import type \{[\s\S]*?\} from ["']([^"']+)["'];/g)]
      .filter((match) => match[1].includes("src/contracts/pos"))
      .map((match) => match[0])
      .join("\n");
    assert.doesNotMatch(rootImports, /PosBootstrapV2CoreResponse/);
  }
});
