import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildIdentityMappingDryRun } from "./phase-f-identity-mapping-dry-run.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const fixture = {
  supabaseUsers: [
    { id: "source-owner", email: "owner@example.invalid" },
    {
      id: "source-invited",
      email: "invited@example.invalid",
      invitedAt: "2026-10-01T00:00:00.000Z",
      emailConfirmedAt: null,
    },
  ],
  neonUsers: [{ id: "target-owner", email: "owner@example.invalid" }],
  profiles: [
    { id: "profile-owner", email: "owner@example.invalid" },
    { id: "profile-invited", email: "invited@example.invalid" },
  ],
  identityLinks: [
    { provider: "supabase", providerSubject: "source-owner", profileId: "profile-owner" },
    { provider: "supabase", providerSubject: "source-invited", profileId: "profile-invited" },
  ],
};

test("F2 emits a deterministic, pseudonymous, no-write migration rehearsal", () => {
  const first = buildIdentityMappingDryRun(fixture);
  const reversed = buildIdentityMappingDryRun({
    supabaseUsers: [...fixture.supabaseUsers].reverse(),
    neonUsers: [...fixture.neonUsers].reverse(),
    profiles: [...fixture.profiles].reverse(),
    identityLinks: [...fixture.identityLinks].reverse(),
  });

  assert.deepEqual(first, reversed);
  assert.equal(first.schemaVersion, "tindio.identity-migration-dry-run.v1");
  assert.equal(first.mode, "DRY_RUN_NO_WRITES");
  assert.equal(first.decision, "OWNER_REVIEW_REQUIRED");
  assert.deepEqual(first.safety, {
    identityLinkWrites: 0,
    providerUserWrites: 0,
    passwordHashesRead: 0,
    passwordHashesMigrated: 0,
    rawIdentityValuesEmitted: 0,
  });
  const serialized = JSON.stringify(first);
  for (const secret of [
    "owner@example.invalid",
    "invited@example.invalid",
    "source-owner",
    "target-owner",
    "profile-owner",
  ]) assert.doesNotMatch(serialized, new RegExp(secret));
});

test("F2 blocks duplicates, orphan targets, and conflicting stable-profile mappings", () => {
  const report = buildIdentityMappingDryRun({
    supabaseUsers: [
      { id: "source-duplicate", email: "one@example.invalid" },
      { id: "source-duplicate", email: "two@example.invalid" },
    ],
    neonUsers: [{ id: "target-orphan", email: "orphan@example.invalid" }],
    profiles: [{ id: "profile-a", email: "one@example.invalid" }],
    identityLinks: [
      { provider: "supabase", providerSubject: "source-duplicate", profileId: "profile-a" },
      { provider: "supabase", providerSubject: "source-other", profileId: "profile-a" },
    ],
  });

  assert.equal(report.decision, "BLOCKED");
  const codes = new Set(report.issues.map(({ code }) => code));
  assert.equal(codes.has("DUPLICATE_SUPABASE_SUBJECT"), true);
  assert.equal(codes.has("PROFILE_HAS_MULTIPLE_PROVIDER_SUBJECTS"), true);
  assert.equal(codes.has("NEON_ACCOUNT_WITHOUT_SOURCE_OR_LINK"), true);
});

test("F2 evidence and package command preserve the owner stop", async () => {
  const [evidenceSource, plan, packageSource] = await Promise.all([
    read("docs/architecture/TINDIO_PHASE_F2_DRY_RUN_PROOF.json"),
    read("docs/architecture/TINDIO_IDENTITY_MAPPING_PLAN.md"),
    read("package.json"),
  ]);
  const evidence = JSON.parse(evidenceSource);
  const packageJson = JSON.parse(packageSource);
  assert.equal(evidence.status, "PASS");
  assert.equal(evidence.productionUsersWritten, 0);
  assert.equal(evidence.passwordHashesMigrated, 0);
  assert.match(plan, /F2 COMPLETE/);
  assert.equal(
    packageJson.scripts["test:architecture-phase-f2-identity-dry-run"],
    "node --test scripts/architecture-phase-f2-identity-dry-run-check.mjs",
  );
});
