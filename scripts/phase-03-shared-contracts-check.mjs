import assert from "node:assert/strict";
import {
  execFileSync,
} from "node:child_process";
import {
  readFile,
} from "node:fs/promises";
import test from "node:test";

const BASE_SHA =
  "698f9838577e1e98f93f6f4ddaf08eee9bcf8012";

const PHASE_FINAL_SHA =
  "a0c0665b6822eccfe9527d774a6d4e5c546feb96";

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
  contract,
  ticketSchema,
  ticketService,
  data,
  catalog,
  customers,
  modifiers,
  receipts,
  receiptDetail,
  attendance,
  transfer,
  stockRequest,
  bootstrap,
  workflow,
  packageText,
] =
  await Promise.all([
    source(
      "src/contracts/pos-v1.ts",
    ),
    source(
      "src/features/advanced-sales/ticket-schema.ts",
    ),
    source(
      "src/features/advanced-sales/ticket-service.ts",
    ),
    source(
      "src/features/pos/data.ts",
    ),
    source(
      "src/app/api/pos/catalog/route.ts",
    ),
    source(
      "src/app/api/pos/customers/route.ts",
    ),
    source(
      "src/app/api/pos/modifiers/route.ts",
    ),
    source(
      "src/app/api/pos/v1/receipts/route.ts",
    ),
    source(
      "src/app/api/pos/v1/receipts/[receiptId]/route.ts",
    ),
    source(
      "src/app/api/pos/v1/attendance/employees/route.ts",
    ),
    source(
      "src/app/api/pos/v1/transfers/[transferId]/receive/route.ts",
    ),
    source(
      "src/app/api/pos/v1/stock-requests/[stockRequestId]/receive/route.ts",
    ),
    source(
      "src/app/api/pos/v1/bootstrap/route.ts",
    ),
    source(
      ".github/workflows/tindio-baseline-certification.yml",
    ),
    source("package.json"),
  ]);

const packageJson =
  JSON.parse(packageText);

test(
  "POS v1 has one client-safe canonical contract entrypoint",
  () => {
    assert.match(
      contract,
      /TINDIO_POS_API_VERSION/,
    );

    assert.match(
      contract,
      /posCatalogQuerySchema/,
    );

    assert.match(
      contract,
      /posCustomerSearchQuerySchema/,
    );

    assert.match(
      contract,
      /posModifierQuerySchema/,
    );

    assert.match(
      contract,
      /posReceiptSearchQuerySchema/,
    );

    assert.match(
      contract,
      /PosBootstrapResponse/,
    );

    assert.match(
      contract,
      /PosWorkspaceContract/,
    );

    assert.match(
      contract,
      /PosReceiptDetail/,
    );

    assert.doesNotMatch(
      contract,
      /server-only/,
    );

    assert.doesNotMatch(
      contract,
      /next\/|@\/lib\/supabase\/server/,
    );
  },
);

test(
  "ticket request schemas are no longer trapped in the server-only service",
  () => {
    assert.match(
      ticketSchema,
      /saveOpenTicketSchema/,
    );

    assert.match(
      ticketSchema,
      /moveOpenTicketLinesSchema/,
    );

    assert.match(
      ticketSchema,
      /splitOpenTicketSchema/,
    );

    assert.match(
      ticketSchema,
      /mergeOpenTicketsSchema/,
    );

    assert.match(
      ticketSchema,
      /cancelOpenTicketSchema/,
    );

    assert.doesNotMatch(
      ticketSchema,
      /server-only/,
    );

    assert.match(
      ticketService,
      /@\/features\/advanced-sales\/ticket-schema/,
    );

    assert.doesNotMatch(
      ticketService,
      /const saveSchema = z\.object/,
    );

    assert.doesNotMatch(
      ticketService,
      /const cartLineSchema = z\.object/,
    );
  },
);

test(
  "POS transport query schemas consume the canonical contracts",
  () => {
    assert.match(
      catalog,
      /posCatalogQuerySchema as catalogRequestSchema/,
    );

    assert.match(
      customers,
      /posCustomerSearchQuerySchema as querySchema/,
    );

    assert.match(
      modifiers,
      /posModifierQuerySchema as schema/,
    );

    assert.match(
      receipts,
      /posReceiptSearchQuerySchema as querySchema/,
    );

    assert.match(
      receiptDetail,
      /posUuidSchema as receiptIdSchema/,
    );

    assert.match(
      attendance,
      /posUuidSchema as storeSchema/,
    );

    assert.match(
      transfer,
      /posUuidSchema as idSchema/,
    );

    assert.match(
      stockRequest,
      /posUuidSchema as idSchema/,
    );

    for (
      const route
      of [
        catalog,
        customers,
        modifiers,
        receipts,
        receiptDetail,
        attendance,
        transfer,
        stockRequest,
      ]
    ) {
      assert.doesNotMatch(
        route,
        /from "zod"/,
      );
    }
  },
);

test(
  "server data reuses shared workspace and receipt DTOs",
  () => {
    assert.match(
      data,
      /PosWorkspaceContract/,
    );

    assert.match(
      data,
      /PosReceiptDetail/,
    );

    assert.match(
      data,
      /PosReceiptSummary/,
    );

    assert.doesNotMatch(
      data,
      /export type PosReceiptSummary = \{/,
    );

    assert.doesNotMatch(
      data,
      /export type PosReceiptDetail = \{/,
    );
  },
);

test(
  "bootstrap is explicitly typed by the shared contract",
  () => {
    assert.match(
      bootstrap,
      /PosBootstrapResponse/,
    );

    assert.match(
      bootstrap,
      /const response:\s*PosBootstrapResponse/,
    );
  },
);

test(
  "Phase 03 does not create database or generated-type drift",
  () => {
    for (
      const target
      of [
        "supabase/migrations",
        "src/lib/supabase/database.types.ts",
      ]
    ) {
      const committed =
        execFileSync(
          "git",
          [
            "diff",
            "--name-only",
            `${BASE_SHA}...${PHASE_FINAL_SHA}`,
            "--",
            target,
          ],
          {
            encoding: "utf8",
          },
        ).trim();

      const dirty =
        execFileSync(
          "git",
          [
            "status",
            "--porcelain",
            "--",
            target,
          ],
          {
            encoding: "utf8",
          },
        ).trim();

      assert.equal(
        committed,
        "",
        `${target} changed during Phase 03`,
      );

      assert.equal(
        dirty,
        "",
        `${target} has uncommitted Phase 03 drift`,
      );
    }
  },
);

test(
  "Phase 03 keeps prior contracts and removes duplicate feature-branch full CI",
  () => {
    assert.equal(
      packageJson.scripts[
        "test:phase-01-pos-api-contract"
      ],
      "node --test scripts/phase-01-pos-api-contract-check.mjs",
    );

    assert.equal(
      packageJson.scripts[
        "test:phase-02-mobile-auth-contract"
      ],
      "node --test scripts/phase-02-mobile-auth-contract-check.mjs",
    );

    assert.equal(
      packageJson.scripts[
        "test:phase-03-shared-contracts"
      ],
      "node --test scripts/phase-03-shared-contracts-check.mjs",
    );

    assert.match(
      workflow,
      /push:\s*\n\s*branches:\s*\n\s*-\s*TINDIO-PREPRODUCTION/,
    );

    assert.doesNotMatch(
      workflow,
      /-\s*"mobile\/\*\*"/,
    );

    assert.doesNotMatch(
      workflow,
      /-\s*"migration\/\*\*"/,
    );

    assert.match(
      workflow,
      /pull_request:\s*\n\s*branches:\s*\n\s*-\s*TINDIO-PREPRODUCTION/,
    );
  },
);
