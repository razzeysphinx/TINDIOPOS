import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const BASE_SHA = "698f9838577e1e98f93f6f4ddaf08eee9bcf8012";
const PHASE_FINAL_SHA = "a0c0665b6822eccfe9527d774a6d4e5c546feb96";

async function source(target) {
  return readFile(new URL(`../${target}`, import.meta.url), "utf8");
}

const [
  contract,
  ticketSchema,
  ticketService,
  data,
  catalogResolver,
  customers,
  modifiers,
  receipts,
  receiptDetail,
  attendance,
  transfer,
  stockRequest,
  bootstrap,
  reference,
  live,
  workflow,
  packageText,
] = await Promise.all([
  source("src/contracts/pos.ts"),
  source("src/features/advanced-sales/ticket-schema.ts"),
  source("src/features/advanced-sales/ticket-service.ts"),
  source("src/features/pos/data.ts"),
  source("src/lib/auth/pos-v2-catalog.ts"),
  source("src/app/api/pos/v2/customers/route.ts"),
  source("src/app/api/pos/v2/modifiers/route.ts"),
  source("src/app/api/pos/v2/receipts/route.ts"),
  source("src/app/api/pos/v2/receipts/[receiptId]/route.ts"),
  source("src/app/api/pos/v2/attendance/employees/route.ts"),
  source("src/app/api/pos/v2/transfers/[transferId]/receive/route.ts"),
  source("src/app/api/pos/v2/stock-requests/[stockRequestId]/receive/route.ts"),
  source("src/app/api/pos/v2/bootstrap/route.ts"),
  source("src/app/api/pos/v2/reference/route.ts"),
  source("src/app/api/pos/v2/live/route.ts"),
  source(".github/workflows/tindio-baseline-certification.yml"),
  source("package.json"),
]);

const packageJson = JSON.parse(packageText);

test("current POS V2 has one client-safe canonical contract entrypoint", () => {
  assert.match(contract, /TINDIO_POS_API_VERSION\s*=\s*["']v2["']/);
  assert.match(contract, /posCatalogV2QuerySchema/);
  assert.match(contract, /posCustomerSearchQuerySchema/);
  assert.match(contract, /posModifierQuerySchema/);
  assert.match(contract, /posReceiptSearchQuerySchema/);
  assert.match(contract, /PosBootstrapV2CoreResponse/);
  assert.match(contract, /PosReferenceV2Response/);
  assert.match(contract, /PosLiveV2Response/);
  assert.match(contract, /PosCatalogV2Response/);
  assert.match(contract, /PosModifiersV2Response/);
  assert.match(contract, /PosSupportWorkspace/);
  assert.match(contract, /PosReceiptDetail/);
  assert.doesNotMatch(
    contract,
    new RegExp(
      [
        ["Pos", "BootstrapResponse"].join(""),
        ["Pos", "WorkspaceContract"].join(""),
        ["posCatalog", "QuerySchema"].join(""),
      ].join("|"),
    ),
  );
  assert.doesNotMatch(contract, /server-only|next\/|@\/lib\/supabase\/server/);
});

test("ticket request schemas are not trapped in the server-only service", () => {
  for (const schema of [
    "saveOpenTicketSchema",
    "moveOpenTicketLinesSchema",
    "splitOpenTicketSchema",
    "mergeOpenTicketsSchema",
    "cancelOpenTicketSchema",
  ]) assert.match(ticketSchema, new RegExp(schema));

  assert.doesNotMatch(ticketSchema, /server-only/);
  assert.match(ticketService, /@\/features\/advanced-sales\/ticket-schema/);
  assert.doesNotMatch(ticketService, /const saveSchema = z\.object|const cartLineSchema = z\.object/);
});

test("POS V2 transports consume shared current contracts", () => {
  assert.match(catalogResolver, /posCatalogV2QuerySchema/);
  assert.match(customers, /posCustomerSearchQuerySchema as querySchema/);
  assert.match(catalogResolver, /posModifierQuerySchema/);
  assert.match(receipts, /posReceiptSearchQuerySchema as querySchema/);
  assert.match(receiptDetail, /posUuidSchema as receiptIdSchema/);
  assert.match(attendance, /posUuidSchema as storeSchema/);
  assert.match(transfer, /posUuidSchema as idSchema/);
  assert.match(stockRequest, /posUuidSchema as idSchema/);

  for (const route of [customers, modifiers, receipts, receiptDetail, attendance, transfer, stockRequest]) {
    assert.doesNotMatch(route, /from "zod"/);
  }
});

test("server support data reuses shared workspace and receipt DTOs", () => {
  assert.match(data, /PosSupportWorkspace/);
  assert.match(data, /PosReceiptDetail/);
  assert.match(data, /PosReceiptSummary/);
  assert.doesNotMatch(data, /export type PosReceiptSummary = \{|export type PosReceiptDetail = \{/);
});

test("V2 read API responses are explicitly typed by shared contracts", () => {
  assert.match(bootstrap, /getPosV2Core/);
  assert.match(bootstrap, /version: 2/);
  assert.match(reference, /PosReferenceV2Response/);
  assert.match(live, /PosLiveV2Response/);
});

test("Phase 03 does not create database or generated-type drift", () => {
  for (const target of ["supabase/migrations", "src/lib/supabase/database.types.ts"]) {
    const committed = execFileSync("git", ["diff", "--name-only", `${BASE_SHA}...${PHASE_FINAL_SHA}`, "--", target], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", target], { encoding: "utf8" }).trim();
    assert.equal(committed, "", `${target} changed during Phase 03`);
    assert.equal(dirty, "", `${target} has uncommitted Phase 03 drift`);
  }
});

test("Phase 03 keeps prior contracts and avoids duplicate feature-branch full CI", () => {
  assert.equal(packageJson.scripts["test:phase-01-pos-api-contract"], "node --test scripts/phase-01-pos-api-contract-check.mjs");
  assert.equal(packageJson.scripts["test:phase-02-mobile-auth-contract"], "node --test scripts/phase-02-mobile-auth-contract-check.mjs");
  assert.equal(packageJson.scripts["test:phase-03-shared-contracts"], "node --test scripts/phase-03-shared-contracts-check.mjs");
  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*-\s*TINDIO-PREPRODUCTION/);
  assert.doesNotMatch(workflow, /-\s*"mobile\/\*\*"|-\s*"migration\/\*\*"/);
  assert.match(workflow, /pull_request:\s*\n\s*branches:\s*\n\s*-\s*TINDIO-PREPRODUCTION/);
});
