# MOB-10 Slice 22 — A47 public policy access

## Phase and ticket

```text
Mobile Phases 23–24
MOB-10 Slice 22
A47 — Privacy/support/deletion request if applicable
```

## Starting commit

```text
6bcfaae6a9fdc1e00ebcc658089b1a6563fb2853
```

## Observed defect

The repository documented an internal privacy data map and retention governance but exposed no public privacy, support or account-deletion URL. The Android application had no discoverable privacy/support links. Phase 24 evidence and promotion gates did not represent A47.

Deletion is applicable: the connected TINDIO web service exposes `/signup`, and the Android application authenticates the same user-facing identity. Existing employee deactivation/archive and organization archival are not sufficient account deletion.

## Architecture decision

Extend the existing Next.js application with three public server-rendered routes and open them from both signed-out and signed-in Android screens. Derive mobile URLs from the existing production API origin so no second host configuration is introduced. Preserve current Supabase Auth, Neon, POS v2, tenant/store authorization and financial retention architecture.

Do not add an unauthenticated database mutation or pretend that archival deletes an account. Because no responsible legal entity, privacy contact or monitored support owner is configured, expose the truthful limitation and keep release promotion blocked.

## Changed surfaces

- Public `/privacy`, `/support` and `/account-deletion` Next.js routes.
- Shared accessible public-information page shell.
- Android signed-out and settings links with visible open-failure feedback.
- Expanded Phase 23 data/retention map and Phase 24 runbook.
- Structured A47 evidence and production-gate enforcement.
- Behavioral source-contract coverage.

## Database, SQLite, and API compatibility

```text
Neon migration: NONE
SQLite migration/reset: NONE
POS v2 API change: NONE
Authentication change: NONE
```

## Security and transaction-custody impact

- Public routes contain policy information only and perform no mutation.
- No deletion endpoint, administrator bypass or unauthenticated identity lookup was introduced.
- Official financial/inventory/audit retention and unresolved mobile custody are explicitly protected.
- No logout, database reset, cache deletion, credential change or transaction-identity change occurs.
- Production mobile builds still require an HTTPS origin before these links can open.

## Certification status

```text
A47 repository implementation: COMPLETE
A47 certification: BLOCKED
Responsible legal entity: NOT CONFIGURED
Privacy contact: NOT CONFIGURED
Named support owner/channel: NOT CONFIGURED
Public production HTTPS origin: NOT CONFIGURED (local environment is 127.0.0.1)
Deletion request intake: NOT OPERATIONAL
Play Console URLs/declarations: NOT_RUN
Live unauthenticated URL verification: NOT_RUN
```

The public source routes must not be represented as a passing deletion request pathway until these blockers are closed.

## Tests and exact results

```text
pnpm test:phase-24-google-play
PASS — 6 tests, 0 failures

pnpm mobile:typecheck
PASS

pnpm typecheck
PASS

affected-file ESLint
PASS — 0 errors, 0 warnings

pnpm lint
PASS — 0 errors, 3 pre-existing warnings

pnpm run build
PASS — Next.js 16.3.1 production build; /privacy, /support and /account-deletion statically generated

Android Expo export
PASS — 1,450 modules bundled

local production-server HTTP smoke test
PASS — all three public routes returned HTTP 200 with TINDIO identity and an H1

pnpm certify:static
155/156 package commands PASS — only test:phase-04-docker-source-connectivity failed because the local Supabase source is unavailable

git diff --check
PASS

Phase 24 production release gate
EXPECTED BLOCK — A46 and A47 external evidence, AAB, testing ladder, pilot and real-store evidence remain NOT_RUN
```

## Policy basis

Google Play's current User Data policy requires a public, active, non-geofenced privacy policy and an in-app privacy path. Because TINDIO permits account creation, it also requires a discoverable in-app and external account-deletion request path; deactivation is not deletion, and legitimate retention must be explained.

Official references:

- https://support.google.com/googleplay/android-developer/answer/10144311
- https://support.google.com/googleplay/android-developer/answer/13327111

## Next smallest safe slice

Provide and approve the responsible entity, privacy contact, monitored support owner/channel and production domain; then deploy and verify A47 on the public origin. Do not begin A48 until the production release-candidate prerequisites are available.
