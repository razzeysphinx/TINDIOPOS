import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("customer-display update has a focused shared validation and HTTP contract", async () => {
  const [manifestSource, contract] = await Promise.all([
    read("packages/contracts/package.json"),
    read("packages/contracts/src/customer-display.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.exports["./customer-display"].types, "./src/customer-display.ts");
  for (const value of [
    "CUSTOMER_DISPLAY_UPDATE_PATH",
    "CUSTOMER_DISPLAY_UPDATE_RPC",
    "CUSTOMER_DISPLAY_UPDATE_PERMISSIONS",
    "CUSTOMER_DISPLAY_PERMISSION_ERROR",
    "CUSTOMER_DISPLAY_INVALID_ERROR",
    "CUSTOMER_DISPLAY_OPEN_SHIFT_ERROR",
    "CUSTOMER_DISPLAY_UPDATE_ERROR",
    "CUSTOMER_DISPLAY_OPEN_SHIFT_DATABASE_CODE",
    "customerDisplayStateSchema",
    "customerDisplayUpdateSchema",
    "CustomerDisplayState",
    "CustomerDisplayUpdate",
  ]) assert.match(contract, new RegExp(`\\b${value}\\b`));

  for (const value of [
    '"idle"',
    '"cart"',
    '"payment"',
    '"complete"',
    "10_000",
    "1_000_000_000_000",
    "100_000_000",
    ".max(100)",
    ".max(50)",
    ".max(10)",
    ".datetime()",
  ]) assert.ok(contract.includes(value), `missing shared contract value ${value}`);

  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("Web rollback route consumes the shared contract", async () => {
  const [route, facade, legacyRoute] = await Promise.all([
    read("src/app/api/pos/v2/customer-display/route.ts"),
    read("src/features/customer-display/customer-display-types.ts"),
    read("src/app/api/pos/customer-display/route.ts"),
  ]);

  assert.match(route, /export async function PUT/);
  assert.doesNotMatch(route, /export async function (?:GET|POST|PATCH|DELETE)/);
  assert.match(route, /from ["']@tindio\/contracts\/customer-display["']/);
  assert.match(route, /getPosV2BusinessContext/);
  assert.match(route, /CUSTOMER_DISPLAY_UPDATE_PERMISSIONS\[0\]/);
  assert.match(route, /CUSTOMER_DISPLAY_UPDATE_PERMISSIONS\[1\]/);
  assert.match(route, /customerDisplayUpdateSchema\.safeParse/);
  assert.match(route, /createBusinessContextClient/);
  assert.match(route, /supabase\.rpc\(CUSTOMER_DISPLAY_UPDATE_RPC/);
  for (const argument of [
    "target_organization_id",
    "target_session_id",
    "target_state",
  ]) assert.match(route, new RegExp(`\\b${argument}\\b`));
  assert.match(route, /status:\s*204/);
  assert.match(route, /Cache-Control["']?:\s*["']no-store["']/);
  assert.match(facade, /from ["']@tindio\/contracts\/customer-display["']/);
  assert.match(legacyRoute, /from ["']@\/app\/api\/pos\/v2\/customer-display\/route["']/);
});

test("Backend compatibility oracle remains runtime-independent beside the owned route", async () => {
  const oracle = await read("apps/backend/src/pos/customer-display-compatibility.ts");

  assert.match(oracle, /from ["']@tindio\/contracts\/customer-display["']/);
  assert.match(oracle, /CUSTOMER_DISPLAY_COMPATIBILITY_CONTRACT/);
  assert.match(oracle, /validateCustomerDisplayUpdate/);
  assert.match(oracle, /customerDisplayPermissionFailure/);
  assert.match(oracle, /mapCustomerDisplayRpcError/);
  assert.doesNotMatch(oracle, /fetch\(|createPosReadRuntime|createNeonDataApiFetch|\.rpc\(|process\.env/);
  assert.equal(existsSync(new URL("../apps/backend/api/pos/v2/customer-display.ts", import.meta.url)), true);
});

test("database authority retains permission, active-session, open-shift, and role grants", async () => {
  const [baseline, providerNeutral] = await Promise.all([
    read("database/baseline/0001_tindio_baseline.sql"),
    read("database/migrations/0003_provider_neutral_roles_rls.sql"),
  ]);

  const functionStart = baseline.indexOf(
    'CREATE OR REPLACE FUNCTION "private"."set_customer_display_state"',
  );
  const functionEnd = baseline.indexOf(
    '-- Name: set_employee_pin',
    functionStart,
  );
  const body = baseline.slice(functionStart, functionEnd);

  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET "search_path" TO ''/);
  assert.match(body, /private\.current_profile_id\(\)/);
  assert.match(body, /private\.has_permission\(target_organization_id, 'sales\.create'\)/);
  assert.match(body, /display\.organization_id = target_organization_id/);
  assert.match(body, /display\.is_active/);
  assert.match(body, /shift\.store_id = resolved_store_id/);
  assert.match(body, /shift\.register_id = resolved_register_id/);
  assert.match(body, /shift\.opened_by_employee_id = actor_employee_id/);
  assert.match(body, /shift\.status = 'open'/);
  assert.match(body, /last_published_at = now\(\)/);
  assert.match(providerNeutral, /REVOKE ALL ON FUNCTION "public"\."set_customer_display_state"[^;]+FROM "authenticated"/);
  assert.match(providerNeutral, /GRANT ALL ON FUNCTION "public"\."set_customer_display_state"[^;]+TO "tindio_authenticated"/);
});

test("customer-display ownership leaves clients, origins, financial mutations, and deployment unchanged", async () => {
  const [terminal, checkout, refund, syncPush, backendReadme] = await Promise.all([
    read("src/features/pos/pos-terminal.tsx"),
    read("src/app/api/pos/v2/checkout/route.ts"),
    read("src/app/api/pos/v2/receipts/[receiptId]/refund/route.ts"),
    read("src/app/api/pos/v2/sync/push/route.ts"),
    read("apps/backend/README.md"),
  ]);

  assert.match(terminal, /["']\/api\/pos\/v2\/customer-display["']/);
  assert.match(terminal, /method:\s*["']PUT["']/);
  assert.match(checkout, /export async function POST/);
  assert.match(refund, /export async function POST/);
  assert.match(syncPush, /export async function POST/);
  assert.match(backendReadme, /No financial, custody, attendance, or offline-replayed mutation/);
  assert.match(backendReadme, /TINDIO_CUSTOMER_DISPLAY_UPDATE_MODE/);
});
