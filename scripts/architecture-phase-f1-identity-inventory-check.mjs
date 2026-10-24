import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildIdentityMappingDryRun } from "./phase-f-identity-mapping-dry-run.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("F1 dry run preserves stable profiles and never migrates password hashes", () => {
  const report = buildIdentityMappingDryRun({
    supabaseUsers: [
      { id: "supabase-a", email: "Owner@Tindio.Test" },
      { id: "supabase-b", email: "unlinked@tindio.test" },
    ],
    neonUsers: [{ id: "neon-a", email: "owner@tindio.test" }],
    profiles: [
      { id: "profile-a", email: "owner@tindio.test" },
      { id: "profile-b", email: "unlinked@tindio.test" },
    ],
    identityLinks: [
      { provider: "supabase", providerSubject: "supabase-a", profileId: "profile-a" },
    ],
  });
  assert.equal(report.mode, "DRY_RUN_NO_WRITES");
  assert.equal(report.counts.ACCOUNTED_FOR, 1);
  assert.equal(report.counts.REVIEW_REQUIRED, 1);
  assert.equal(report.records[0].neonAction, "PROPOSE_LINK_AFTER_OWNER_REVIEW");
  assert.equal(report.records.every(({ passwordAction }) => passwordAction === "RESET_REQUIRED_NO_HASH_MIGRATION"), true);
  assert.doesNotMatch(JSON.stringify(report), /Owner@Tindio|owner@tindio|unlinked@tindio/);
});

test("F1 blocks ambiguous and conflicting identity mappings", () => {
  const report = buildIdentityMappingDryRun({
    supabaseUsers: [{ id: "supabase-a", email: "duplicate@tindio.test" }],
    neonUsers: [{ id: "neon-a", email: "duplicate@tindio.test" }],
    profiles: [
      { id: "profile-a", email: "duplicate@tindio.test" },
      { id: "profile-b", email: "duplicate@tindio.test" },
    ],
    identityLinks: [
      { provider: "neon", providerSubject: "neon-a", profileId: "profile-b" },
    ],
  });
  assert.equal(report.records[0].status, "BLOCKED");
  assert.equal(report.records[0].reason, "DUPLICATE_PROFILE_EMAIL");
});

test("F1 documents aggregate inventory and the remaining authorization boundary", async () => {
  const [planSource, evidenceSource, packageSource] = await Promise.all([
    read("docs/architecture/TINDIO_IDENTITY_MAPPING_PLAN.md"),
    read("docs/architecture/TINDIO_PHASE_F1_IDENTITY_INVENTORY.json"),
    read("package.json"),
  ]);
  const evidence = JSON.parse(evidenceSource);
  const packageJson = JSON.parse(packageSource);
  assert.equal(evidence.canonicalAggregate.profiles, 2);
  assert.equal(evidence.canonicalAggregate.supabaseLinks, 2);
  assert.equal(evidence.canonicalAggregate.neonLinks, 0);
  assert.equal(evidence.canonicalAggregate.duplicateNormalizedEmails, 0);
  assert.equal(evidence.supabaseAuthInventory.status, "BLOCKED_MISSING_MANAGEMENT_CREDENTIAL");
  assert.match(planSource, /No identity link is written by the dry-run tool/);
  assert.match(planSource, /OWNER APPROVAL REQUIRED/);
  assert.equal(packageJson.scripts["test:architecture-phase-f1-identity-inventory"], "node --test scripts/architecture-phase-f1-identity-inventory-check.mjs");
});
