import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [
  packageText,
  certification,
  handover,
  recoveryProcedure,
  manualEvidence,
  phase05,
  phase06,
  phase07,
  phase08,
  phase09,
  phase10,
  phase11,
  phase12,
  phase13,
  phase14,
  playwrightConfig,
  playwrightRunner,
  playwrightSpec,
] = await Promise.all([
  source("package.json"),
  source("scripts/certify-repository.mjs"),
  source("docs/TINDIO_INVENTORY_FULL_RECOVERY_REDESIGN_HANDOVER.md"),
  source("docs/backup-recovery-and-data-governance.md"),
  source("docs/recovery/phase-14-manual-certification.md"),
  source("docs/recovery/phase-contracts/phase-05.json"),
  source("docs/recovery/phase-contracts/phase-06.json"),
  source("docs/recovery/phase-contracts/phase-07.json"),
  source("docs/recovery/phase-contracts/phase-08.json"),
  source("docs/recovery/phase-contracts/phase-09.json"),
  source("docs/recovery/phase-contracts/phase-10.json"),
  source("docs/recovery/phase-contracts/phase-11.json"),
  source("docs/recovery/phase-contracts/phase-12.json"),
  source("docs/recovery/phase-contracts/phase-13.json"),
  source("docs/recovery/phase-contracts/phase-14.json"),
  source("playwright.config.ts"),
  source("scripts/phase-14-playwright-run.mjs"),
  source("tests/e2e/phase-14/phase-14-browser.spec.ts"),
]);

const packageJson = JSON.parse(packageText);

assert.equal(
  typeof packageJson.scripts?.["test:phase-14-browser"],
  "string",
  "test:phase-14-browser must remain registered",
);
assert.match(playwrightConfig, /http:\/\/127\.0\.0\.1:3100/);
assert.match(playwrightRunner, /PHASE 14 PLAYWRIGHT BROWSER CERTIFICATION: PASS/);
assert.match(playwrightSpec, /P14-BR-01/);
assert.match(playwrightSpec, /P14-BR-20/);

const controllerScripts = [
  "test:phase-05-controller-contract",
  "test:phase-06-controller-contract",
  "test:phase-07-controller-contract",
  "test:phase-08-controller-contract",
  "test:phase-09-controller-contract",
  "test:phase-10-controller-contract",
  "test:phase-11-controller-contract",
  "test:phase-12-controller-contract",
  "test:phase-13-controller-contract",
  "test:phase-14-controller-contract",
];

const domainScripts = [
  "test:inventory-transfer-foundation",
  "test:inventory-request-transfer-migration",
  "test:inventory-adjustments-opening-stock",
  "test:inventory-counts-stocktake",
  "test:purchasing-receiving",
  "test:product-units-conversion",
  "test:supplier-returns",
  "test:composite-production",
  "test:inventory-replenishment-settings",
];

const concurrencyScripts = [
  "scripts/inventory-reconciliation-concurrency-certification.mjs",
  "scripts/inventory-transfer-concurrency-certification.mjs",
  "scripts/inventory-request-transfer-concurrency-certification.mjs",
  "scripts/inventory-adjustment-concurrency-certification.mjs",
  "scripts/inventory-count-concurrency-certification.mjs",
  "scripts/purchase-order-receipt-concurrency-certification.mjs",
  "scripts/product-unit-concurrency-certification.mjs",
  "scripts/supplier-return-concurrency-certification.mjs",
  "scripts/composite-production-concurrency-certification.mjs",
  "scripts/inventory-replenishment-settings-concurrency-certification.mjs",
];

test("all inventory recovery phase controller contracts remain mandatory", () => {
  for (const scriptName of controllerScripts) {
    assert.equal(
      typeof packageJson.scripts?.[scriptName],
      "string",
      `${scriptName} must remain registered`,
    );

    assert.match(
      certification,
      new RegExp(
        scriptName.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      ),
      `${scriptName} must remain pinned by authoritative certification`,
    );
  }
});

test("all canonical recovery domain checks remain registered", () => {
  for (const scriptName of domainScripts) {
    assert.equal(
      typeof packageJson.scripts?.[scriptName],
      "string",
      `${scriptName} must remain registered`,
    );
  }
});

test("database certification runs every required recovery concurrency proof", () => {
  for (const path of concurrencyScripts) {
    assert.match(
      certification,
      new RegExp(
        path.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      ),
      `${path} must run in authoritative database certification`,
    );
  }
});

test("recovery phase manifests form one continuous Phase 05 through Phase 14 chain", () => {
  const manifests = [
    phase05,
    phase06,
    phase07,
    phase08,
    phase09,
    phase10,
    phase11,
    phase12,
    phase13,
    phase14,
  ].map((text) => JSON.parse(text));

  assert.deepEqual(
    manifests.map((manifest) => String(manifest.phase).padStart(2, "0")),
    ["05", "06", "07", "08", "09", "10", "11", "12", "13", "14"],
  );
});

test("the final certification still covers the handover's unresolved recovery evidence", () => {
  for (const phrase of [
    "Product and variant creation.",
    "Inventory assignment across stores.",
    "Opening stock.",
    "Counts with intervening stock movement.",
    "Store A → Store B transfer.",
    "Low-stock thresholds and reorder calculations.",
    "Unit conversions and rounding.",
    "Valuation across transfers and receipts.",
    "Owner and custom-role access.",
    "Tenant isolation.",
    "Audit trails and source-document navigation.",
    "Browser behavior and application error handling.",
  ]) {
    assert.match(handover, new RegExp(
      phrase.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ));
  }

  assert.match(handover, /manual integration flows/i);
  assert.match(handover, /migration rehearsal/i);
  assert.match(handover, /rollback validation/i);
});

test("backup and recovery procedure remains isolated and non-destructive", () => {
  assert.match(recoveryProcedure, /isolated environment/i);
  assert.match(recoveryProcedure, /Never test a restore over the production project/i);
  assert.match(recoveryProcedure, /does not automatically restore a Supabase project/i);
  assert.match(recoveryProcedure, /Storage objects separately/i);
});

test("manual Phase 14 browser and integration evidence is explicitly complete", () => {
  assert.match(
    manualEvidence,
    /^FINAL_MANUAL_STATUS:\s*PASS$/m,
  );

  const requiredIds = [
    "P14-BR-01",
    "P14-BR-02",
    "P14-BR-03",
    "P14-BR-04",
    "P14-BR-05",
    "P14-BR-06",
    "P14-BR-07",
    "P14-BR-08",
    "P14-BR-09",
    "P14-BR-10",
    "P14-BR-11",
    "P14-BR-12",
    "P14-BR-13",
    "P14-BR-14",
    "P14-BR-15",
    "P14-BR-16",
    "P14-BR-17",
    "P14-BR-18",
    "P14-BR-19",
    "P14-BR-20",
  ];

  for (const id of requiredIds) {
    assert.match(
      manualEvidence,
      new RegExp(
        `\\|\\s*${id}\\s*\\|\\s*PASS\\s*\\|`,
      ),
      `${id} requires recorded PASS evidence`,
    );
  }

  assert.doesNotMatch(
    manualEvidence,
    /\|\s*P14-BR-\d+\s*\|\s*(?:PENDING|FAIL|BLOCKED)\s*\|/,
  );
});
