# MOB-10 Slice 21 — A46 Play reviewer access

## Phase and ticket

```text
Mobile Phase 24
MOB-10 Slice 21
A46 — Play reviewer credentials and restricted feature access
```

## Starting commit

```text
266655f2ce6c2b2b1d77413fcbcb7e50cb5056fb
```

## Observed defect

Phase 24 mentioned an app-access declaration but did not define a reviewer credential contract, prove fresh-install self-enrollment, enumerate the declared mobile functions, or block promotion when reviewer access was unverified. A credential with cashier access but without `devices.manage` could sign in and still strand a Play reviewer at device enrollment.

## Architecture decision

Preserve the current Supabase Auth, provider-neutral identity, POS v2, Neon, enrollment, permission, and feature-gate architecture. Add a secret-free reviewer runbook and structured evidence. Require a dedicated synthetic reviewer identity that can self-enroll a fresh install. Keep credentials only in Play Console and the approved secret manager. Make the existing Phase 24 production gate fail closed until the reviewer walkthrough is `PASS`.

No alternate authentication path, enrollment bypass, hidden reviewer role, or production-data access was added.

## Changed files

- `docs/mobile-program/GOOGLE_PLAY_REVIEWER_ACCESS.md`
- `docs/mobile-program/PHASE_24_GOOGLE_PLAY_RELEASE_RUNBOOK.md`
- `docs/mobile-program/PHASE_24_GOOGLE_PLAY_TESTING_RELEASE.md`
- `docs/mobile-program/evidence/PHASE_24_GOOGLE_PLAY_RELEASE_EVIDENCE.json`
- `scripts/phase-24-google-play-config-check.mjs`
- `scripts/phase-24-release-evidence-check.mjs`
- `scripts/phase-24-production-release-gate.mjs`
- this closure record

## Database, SQLite, and API compatibility

```text
Neon migration: NONE
SQLite migration/reset: NONE
API change: NONE
Mobile runtime change: NONE
```

Existing outbox events, device sequences, synchronization cursors, credentials, checkout intents, receipts, recovery records, and unresolved transaction custody are untouched.

## Security and transaction-custody impact

- Reviewer secrets are prohibited from Git and evidence files.
- The reviewer tenant must be synthetic and must contain no production merchant data.
- Fresh-install self-enrollment uses the existing authorized `devices.manage` path.
- Conditional routes remain governed by existing tenant features and employee permissions.
- Offline electronic/card payment remains unavailable.
- The release gate now rejects `NOT_RUN`, `BLOCKED`, or `FAIL` reviewer access.
- No logout, reset, cache deletion, identity replacement, or custody mutation occurs.

## Tests and exact results

```text
pnpm test:phase-24-google-play
PASS — 5 tests, 0 failures

pnpm mobile:typecheck
PASS

pnpm exec eslint scripts/phase-24-google-play-config-check.mjs scripts/phase-24-release-evidence-check.mjs scripts/phase-24-production-release-gate.mjs
PASS

pnpm typecheck
PASS

pnpm lint
PASS — 0 errors, 3 pre-existing warnings

pnpm certify:static
155/156 package commands PASS — only test:phase-04-docker-source-connectivity failed because the local Supabase source is unavailable

git diff --check
PASS

node scripts/phase-24-production-release-gate.mjs
EXPECTED BLOCK — Google Play reviewer access is NOT_RUN; AAB/internal/closed/pilot and real-store evidence are also NOT_RUN
```

## External evidence status

```text
A46 repository implementation: COMPLETE
A46 certification: BLOCKED
Dedicated reviewer credential configured: NO
Play Console app-access entry verified: NO
Exact release-candidate fresh-install walkthrough: NOT_RUN
```

The local environment does not contain `TINDIO_PLAY_REVIEWER_EMAIL` or `TINDIO_PLAY_REVIEWER_PASSWORD`. No credential was fabricated. A46 may be marked `PASS` only after the non-secret timestamps and owner fields are recorded and the exact submitted build completes the documented fresh-install walkthrough.

## Remaining limitations

- Google Play Console is external to this repository.
- A release candidate does not yet exist, so its clean-install reviewer path cannot be certified.
- A47 privacy/support/deletion URL validation and A48 signed production AAB work were not started.

## Next smallest safe slice

```text
A47 — validate public privacy, support, and deletion/applicability URLs and declarations.
```

A48 remains `NOT_RUN` until the real Phase 23/24 production release candidate exists.
