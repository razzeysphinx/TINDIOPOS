# MOB-13 Slice 05 — release-readiness handoff

Status: **IMPLEMENTATION COMPLETE; PRODUCTION RELEASE INPUTS BLOCKED**

> Scope addendum (2026-10-16): this completion statement remains valid for the
> deterministic release-input handoff implemented by Slice 05. A later physical
> review of the full cashier checkout identified an additional presentation
> gap. MOB-13 UI convergence is therefore reopened as Slices 06-14 under
> `TINDIO_POS_WEB_MOBILE_UI_SOURCE_OF_TRUTH.md`. This addendum does not invalidate
> Slice 05 tests or authorize production release.

## Phase and ticket

- Phase: Mobile Phases 23 and 24
- Ticket: MOB-13
- Slice: 05 — deterministic release-readiness handoff
- Starting commit: `5d57e92b50d6c17d09444fc65f94f0146b47b59a`

## Observed defect

The production validator correctly failed closed, but it stopped at the first
missing input. That forced a release operator to resolve blockers one at a time
and made the complete handoff state harder to review. The remaining inputs also
include external approvals and credentials that repository code must not invent.

## Architecture decision

`KEEP + HARDEN` the authoritative production validator and Phase 24 release
gate. Add a read-only audit that evaluates every MOB-13 release input in one
pass, reports fixed non-secret reasons, and exits non-zero while blocked. The
audit does not relax, replace, or automatically update the release manifest.

## Gap matrix

| Classification | Decision |
|---|---|
| KEEP | Expo application, EAS production profile, production validator, Phase 24 gate, candidate assets, and listing copy |
| KEEP + HARDEN | Provide one exhaustive, secret-safe readiness result instead of only the first validation error |
| EXTEND | Phase 24 runbook with the exact readiness command |
| REFACTOR | None |
| REPLACE | None |
| REMOVE | None |
| NEW | Read-only readiness auditor, CLI command, tests, and this handoff |

## Current readiness result

Command:

```text
pnpm audit:mobile-release-readiness
```

Expected current result: `BLOCKED` with exit code 1.

### Passed inventory checks

- branding asset files exist;
- listing copy is present and the short description is within 80 characters;
- candidate feature graphic exists;
- no invalid optional tablet screenshot path is configured;
- Phase 24 public-policy evidence file exists.

The evidence-file check proves inventory only. A47 inside that evidence file
remains `NOT_RUN`; existence is not certification.

### Blocked inputs requiring authorized owners

1. `manifest_status` — final release manifest approval.
2. `eas_identity` — approved EAS owner and UUID project ID.
3. `production_api_origin` — approved public HTTPS API origin and matching EAS environment value.
4. `supabase_auth_origin` — approved public HTTPS Supabase Auth origin and matching EAS environment value.
5. `supabase_publishable_key` — production build-environment value; never commit it to this report.
6. `remote_signing` — EAS remote Android credential inspection and verification timestamp.
7. `branding_approval` — product-owner approval of the candidate icon, adaptive mark, and splash.
8. `listing_approval` — product-owner approval of the listing copy and artwork.
9. `support_email` — monitored support address owned by the responsible business entity.
10. `phone_screenshots` — truthful screenshots from an authorized synthetic release-candidate cashier context.

## Required operator handoff

The authorized release owner must provide or verify the following without
committing secrets:

- approve or reject the candidate TINDIO branding;
- approve or revise the draft Play listing copy;
- supply the monitored support email;
- identify the approved EAS account/project;
- approve the public production API and Supabase Auth origins;
- place public build configuration in the production EAS environment;
- inspect EAS remote signing and record only its non-secret verification time;
- restore a current synthetic cashier context and capture clean phone screenshots;
- complete A47 public privacy, support, and deletion verification separately.

Only after those facts are real may `apps/mobile/production-release.json` be
updated and reviewed. `status` must remain `BLOCKED` until every audit check
passes.

## Changed files

- `apps/mobile/release-inputs.js`
- `scripts/mobile-mob-13-release-readiness.mjs`
- `scripts/mobile-mob-13-release-inputs.test.mjs`
- `package.json`
- `docs/mobile-program/PHASE_24_GOOGLE_PLAY_RELEASE_RUNBOOK.md`
- `docs/mobile-program/MOB_13_SLICE_05_RELEASE_READINESS_HANDOFF.md`

## Database, SQLite, and API compatibility

- Neon/PostgreSQL migration: none.
- SQLite migration/reset: none.
- POS v2 API behavior: unchanged.
- Supabase Auth behavior: unchanged.
- EAS/Play external mutation: none.

## Security and transaction-custody impact

- The audit prints fixed check identifiers and reasons, never environment or
  credential values.
- No keystore, access token, publishable key, password, or service-account file
  is written.
- No outbox event, checkout intent, receipt, recovery row, sequence, cursor,
  credential, or cache record is read, changed, or deleted.
- No production AAB is built and A48 remains `NOT_RUN`.

## Tests and exact results

- MOB-13 release-input suite: 10/10 passed.
- Phase 23 Android hardening: 6/6 passed.
- Phase 24 Google Play configuration/evidence: 7/7 passed.
- Readiness CLI: expected `BLOCKED`, exit 1, 5 passed inventory checks and 10 blocked inputs.
- Production Expo config: expected `MOB-13_PRODUCTION_RELEASE_BLOCKED`, exit 1.
- Phase 24 production gate: expected `PHASE_24_PRODUCTION_BLOCKED`, exit 1.
- Mobile typecheck: passed.
- Root typecheck: passed.
- Lint: passed with 0 errors and 3 pre-existing warnings.
- Android JavaScript export: passed; 1 Android bundle and 27 assets emitted.
- Static certification: 159/161 automated package commands passed. The two
  failures are the existing local-infrastructure gates
  `test:phase-14-final-recovery` and
  `test:phase-04-docker-source-connectivity`; the local Supabase source is
  unavailable.
- Final `git diff --check`: recorded immediately before commit.

## Certification status

MOB-13 implementation is complete at the repository handoff boundary. MOB-13
release inputs remain externally blocked, and Mobile Phase 24 production
certification remains open. Source completion is not production readiness.

## Next smallest safe slice

Proceed to MOB-14 implementation work if the master plan permits independent
progress. Keep this handoff open for authorized product/release owners, and do
not start the production-AAB/A48 workflow until the readiness audit reports
`READY` and the Phase 24 prerequisites are actually satisfied.
