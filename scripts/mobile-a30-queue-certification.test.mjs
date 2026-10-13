import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const policyPath = "apps/mobile/src/features/certification/mob-10-a30-policy.ts";
const harnessPath = "apps/mobile/src/features/certification/mob-10-a30.ts";

async function loadPolicy() {
  const output = ts.transpileModule(fs.readFileSync(policyPath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: policyPath,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const policy = await loadPolicy();

test("A30 harness is impossible in a production build", () => {
  assert.equal(policy.isMob10A30CertificationBuild("production", "MOB10_A30"), false);
  assert.equal(policy.isMob10A30CertificationBuild("preview", "MOB10_A30"), true);
  assert.equal(policy.isMob10A30CertificationBuild("preview", undefined), false);
});

test("A30 policy permits only isolated prepared certification queues", () => {
  const valid = {
    buildProfile: "preview",
    campaign: "MOB10_A30",
    organizationName: "TINDIO Phase 04 Certification",
    productName: "Phase 04F Certification Item",
    count: 100,
    isOffline: true,
    isPrepared: true,
    unresolvedCount: 0,
  };
  assert.equal(policy.validateMob10A30Policy(valid), null);
  assert.equal(policy.validateMob10A30Policy({ ...valid, count: 1_000 }), null);
  assert.equal(policy.validateMob10A30Policy({ ...valid, count: 99 }), "UNSUPPORTED_QUEUE_SIZE");
  assert.equal(policy.validateMob10A30Policy({ ...valid, organizationName: "Merchant" }), "CERTIFICATION_ORGANIZATION_REQUIRED");
  assert.equal(policy.validateMob10A30Policy({ ...valid, productName: "Real product" }), "CERTIFICATION_PRODUCT_REQUIRED");
  assert.equal(policy.validateMob10A30Policy({ ...valid, isOffline: false }), "OFFLINE_MODE_REQUIRED");
  assert.equal(policy.validateMob10A30Policy({ ...valid, isPrepared: false }), "OFFLINE_PREPARATION_REQUIRED");
  assert.equal(policy.validateMob10A30Policy({ ...valid, unresolvedCount: 1 }), "EMPTY_UNRESOLVED_QUEUE_REQUIRED");
});

test("A30 acceptance loop reports durable progress and stops at the first failure", async () => {
  const progress = [];
  const accepted = await policy.runMob10A30AcceptanceLoop({
    count: 100,
    accept: async (index) => `event-${index + 1}`,
    onProgress: (completed) => progress.push(completed),
  });
  assert.equal(accepted.length, 100);
  assert.deepEqual(progress, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);

  let attempts = 0;
  await assert.rejects(() => policy.runMob10A30AcceptanceLoop({
    count: 100,
    accept: async () => {
      attempts += 1;
      if (attempts === 8) throw new Error("DISK_FULL");
      return attempts;
    },
  }), /DISK_FULL/);
  assert.equal(attempts, 8);
});

test("A30 harness uses production acceptance and never edits SQLite directly", () => {
  const source = fs.readFileSync(harnessPath, "utf8");
  assert.match(source, /createOfflineCashSale/);
  assert.match(source, /first\.deviceSequence !== sequence\.nextSequence/);
  assert.doesNotMatch(source, /getTindioDatabase|INSERT\s+INTO|UPDATE\s+outbox_events|DELETE\s+FROM/i);

  const coordinator = fs.readFileSync("apps/mobile/src/features/outbox/outbox-sync.ts", "utf8");
  assert.match(coordinator, /OUTBOX_BATCH_SIZE = 5/);
  assert.match(coordinator, /OUTBOX_TRANSPORT_TIMEOUT_MS = 15_000/);
  assert.match(coordinator, /OUTBOX_MAX_BATCHES = 50/);
});
