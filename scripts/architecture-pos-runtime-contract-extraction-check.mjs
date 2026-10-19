import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shared support workspace retains every aggregate read domain", async () => {
  const contract = await read("packages/contracts/src/pos-runtime.ts");

  for (const field of [
    "stores",
    "categories",
    "registers",
    "paymentMethods",
    "loyaltyProgram",
    "discounts",
    "taxRates",
    "diningOptions",
    "ticketTemplates",
    "customerDisplaySessions",
    "timeClockEntry",
    "activeShift",
    "initialItems",
    "initialFavoriteItems",
    "initialRecentItems",
    "openTickets",
    "ticketAssignees",
    "canReceiveIncomingTransfers",
    "incomingTransfers",
  ]) {
    assert.match(contract, new RegExp(`\\b${field}\\b`));
  }

  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("shared live response retains its V2 envelope and nullable scope", async () => {
  const contract = await read("packages/contracts/src/pos-runtime.ts");

  assert.match(contract, /export type PosLiveV2Response/);
  assert.match(contract, /ok:\s*true/);
  assert.match(contract, /version:\s*2/);
  assert.match(contract, /organizationId:\s*string/);
  assert.match(contract, /storeId:\s*string \| null/);
  assert.match(contract, /registerId:\s*string \| null/);
  assert.match(contract, /live:\s*\{/);
  assert.match(contract, /incomingTransfers:\s*PosIncomingTransfer\[\]/);
  assert.match(contract, /openTickets:\s*PosOpenTicket\[\]/);
});

test("root facade remains compatible and Mobile imports the live envelope from the package", async () => {
  const [posFacade, mobileApi] = await Promise.all([
    read("src/contracts/pos.ts"),
    read("apps/mobile/src/lib/tindio-api.ts"),
  ]);

  for (const typeName of ["PosSupportWorkspace", "PosLiveV2Response"]) {
    assert.match(posFacade, new RegExp(`\\b${typeName}\\b`));
    assert.doesNotMatch(posFacade, new RegExp(`export type ${typeName}\\s*=`));
  }
  assert.match(posFacade, /from ["']@tindio\/contracts["']/);
  assert.match(mobileApi, /PosLiveV2Response,[\s\S]*from ["']@tindio\/contracts["']/);
  const rootImports = [...mobileApi.matchAll(/import type \{[\s\S]*?\} from ["']([^"']+)["'];/g)]
    .filter((match) => match[1].includes("src/contracts/pos"))
    .map((match) => match[0])
    .join("\n");
  assert.doesNotMatch(rootImports, /PosLiveV2Response/);
});
