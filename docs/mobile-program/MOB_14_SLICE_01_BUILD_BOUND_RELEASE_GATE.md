# MOB-14 Slice 01 — Build-bound Phase 24 evidence gate

## Outcome

MOB-14 remains in progress. This slice replaces the permissive Phase 24
evidence check with a fail-closed evaluator. It does not build, upload or
promote an Android artifact. The current candidate remains blocked.

## Starting point

- Branch: `TINDIO-PREPRODUCTION`
- Starting commit: `2aca48211ffd8e9dafc85e81bb4495f8a41ba195`
- Database/SQLite/API changes: none
- Transaction custody changes: none

## Gap matrix

| Decision | Area | Result |
|---|---|---|
| KEEP | Phase 24 evidence file, EAS track configuration and draft production status | Existing release ladder remains authoritative. |
| KEEP + HARDEN | Production evidence gate | Validate evidence fields rather than trusting top-level `PASS` strings. |
| EXTEND | Evidence schema | Add commit, lockfile, AAB hash, artifact, reviewer, account-rule and owner-approved pilot fields. |
| REFACTOR | Required scenario list | Share one canonical scenario list between schema and production-gate tests. |
| REPLACE | None | No application or release architecture is replaced. |
| REMOVE | None | No existing evidence or release control is removed. |
| NEW | Pure gate evaluator and behavioral suite | Exercise complete success and representative fail-closed cases without external mutation. |

## Observed defect

The former production gate iterated only scenario keys present in the JSON and
checked status strings. A missing scenario was invisible. It also did not
require a source commit, lockfile hash, AAB SHA-256, build ID, version code,
artifact links, reviewer identity, account-specific tester/day requirements,
owner-approved pilot coverage or final owner approval.

## Architecture decision

The evidence gate now accepts plain in-memory records and returns all failures.
That makes the release rule deterministic and behaviorally testable. All device,
track, pilot and scenario records must bind to the same AAB SHA-256. The Play
account requirement is recorded explicitly because the applicable tester/day
rule depends on the actual account. Pilot thresholds are recorded as owner-
approved inputs rather than invented by repository code.

Protected components remain unchanged: Expo mobile, POS v2, Supabase Auth,
provider-neutral identity, Neon PostgreSQL, SQLite caches/outbox, checkout and
inventory engines, synchronization cursors, credentials and unresolved
transaction custody.

## Changed files

- `scripts/lib/phase-24-production-evidence.mjs`
- `scripts/phase-24-production-release-gate.mjs`
- `scripts/mobile-mob-14-production-evidence-gate.test.mjs`
- `scripts/phase-24-release-evidence-check.mjs`
- `docs/mobile-program/evidence/PHASE_24_GOOGLE_PLAY_RELEASE_EVIDENCE.json`
- `docs/mobile-program/PHASE_24_GOOGLE_PLAY_RELEASE_RUNBOOK.md`
- `package.json`
- this handoff

## Compatibility and security

There is no database, SQLite, HTTP API, authentication or tenant/store behavior
change. The schema extension affects only the repository release evidence. It
fails closed and contains references to access-controlled artifacts, never
credentials, access tokens, private keys, device secrets or customer payloads.

## Acceptance mapping

- Phase 24 gate checklist items 1, 2, 5, 6 and 10 are enforced structurally.
- A46 and A47 remain `NOT_RUN` in live evidence.
- A48 remains `NOT_RUN`; no production AAB exists in this slice.
- Physical device, internal, closed, pilot and real-store evidence remain
  `NOT_RUN` until performed against the exact signed candidate.

## Validation

- `pnpm test:mobile-mob-14-production-gate`: PASS, 6/6.
- `pnpm test:phase-24-google-play`: PASS, 7/7.
- `pnpm test:mobile-mob-13-release-inputs`: PASS, 10/10.
- `pnpm test:phase-23-android-hardening`: PASS, 6/6.
- `pnpm typecheck`: PASS.
- `pnpm mobile:typecheck`: PASS.
- `pnpm lint`: PASS with 0 errors and 3 pre-existing warnings.
- `pnpm mobile:export:android`: PASS.
- `pnpm gate:phase-24:production`: expected `PHASE_24_PRODUCTION_BLOCKED`.
- `pnpm certify:static`: 160/162 package commands passed. The unchanged
  environment-dependent `test:phase-14-final-recovery` and
  `test:phase-04-docker-source-connectivity` checks failed because the local
  Supabase source is unavailable.
- `git diff --check`: PASS.

## Remaining MOB-14 work

1. Protect the actual production submission command so it invokes this gate.
2. Add native crash/ANR coverage and correct production telemetry semantics.
3. Add actionable sanitized alert routing, named owners and tested runbooks.
4. Collect the external Phase 24 evidence only when the production candidate,
   Play account, testers and pilot are available.
