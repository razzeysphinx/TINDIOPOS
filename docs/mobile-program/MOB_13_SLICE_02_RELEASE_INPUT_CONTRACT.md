# MOB-13 Slice 02 — production release-input contract

## Phase and ticket

```text
Mobile Phases 23 and 24
MOB-13 Slice 02
Production EAS identity, endpoint, signing, branding, and Play-input gate
```

## Starting commit

```text
a35d54fa4994439497ed413d51a6c2925941e14e
```

## Observed defect

The production EAS profile already selected an Android App Bundle, remote
credentials, auto-incrementing remote versions, and the production EAS
environment. Runtime code also required HTTPS. However, the repository had no
approved EAS owner or project binding and did not reject placeholder, local, or
mismatched production origins before the build began.

The configured app icon, adaptive icon, and splash are still Expo template
artwork. No feature graphic, phone screenshots, descriptions, or support email
has been supplied for the Play listing. Remote signing is specified but has not
been inspected. A47 remains blocked because the responsible entity, monitored
contacts, production origin, and public deletion channel have not been
approved and verified.

## Gap matrix

| Classification | Decision |
| --- | --- |
| KEEP | Expo SDK 57 application, package `com.tindio.pos`, version code 2, EAS production AAB profile, remote credentials policy, and remote version auto-increment |
| KEEP + HARDEN | Dynamic Expo config and Phase 24 production gate now fail closed on unresolved release inputs |
| EXTEND | Add one non-secret production release manifest with EAS, endpoint, signing, branding, listing, and policy-evidence references |
| REFACTOR | Phase 23 configuration test recognizes that an intentionally blocked production config must throw before build |
| REPLACE | Implicit operator knowledge with an executable, reviewed release-input contract |
| REMOVE | None |
| NEW | Release-input validator, four behavioral tests, explicit listing inventory, and this evidence report |

## Architecture decision

Keep secrets in EAS/approved secret storage and commit only non-secret release
identity and approval metadata. `app.config.js` reads the release manifest only
for the production profile. A production configuration is rejected unless:

- the manifest is explicitly `READY`;
- the EAS owner and UUID project ID are approved;
- embedded API and Supabase Auth values exactly match the approved public HTTPS
  origins;
- the Supabase publishable key is present and is not a placeholder;
- EAS remote signing was verified and timestamped;
- app icon, adaptive icon, and splash are approved;
- minimum Play listing inputs are recorded and every referenced asset exists.

Development and preview configurations retain their existing behavior. No EAS
project was initialized, no signing credential was requested, and no AAB was
built.

## Current release-input result

```text
Production release manifest: BLOCKED
EAS owner: NOT PROVIDED
EAS project ID: NOT PROVIDED
Production TINDIO API origin: NOT APPROVED
Production Supabase Auth origin: NOT APPROVED
Remote signing credentials: NOT VERIFIED
App/adaptive/splash branding: UNAPPROVED EXPO TEMPLATE
Feature graphic: NOT PROVIDED
Phone/tablet screenshots: NOT PROVIDED
Short/full listing descriptions: NOT PROVIDED
Support email: NOT PROVIDED
A47 public policy/support/deletion evidence: NOT_RUN / BLOCKED
A48 production-signed release candidate: NOT_RUN
```

## Changed files

- `apps/mobile/production-release.json`
- `apps/mobile/release-inputs.js`
- `apps/mobile/app.config.js`
- `apps/mobile/.env.example`
- `scripts/mobile-mob-13-release-inputs.test.mjs`
- Phase 23/24 configuration and release-gate tests
- Phase 24 release runbook
- root package test command
- this evidence report

## Database, SQLite, and API compatibility

```text
Neon migration: NONE
SQLite migration/reset: NONE
POS v2 API change: NONE
Supabase Auth behavior change: NONE
Expo route change: NONE
EAS/Play external mutation: NONE
```

The contract validates which public origins may be embedded; it does not change
either endpoint or authentication provider.

## Security and transaction-custody impact

- No signing key, service-account credential, access token, password, or
  publishable-key value is committed.
- Local, loopback, IP-literal, reserved test/example, credentialed, and
  path-bearing production origins are rejected.
- The release manifest cannot alter sales, payments, receipts, inventory,
  authorization, or synchronization behavior.
- No local cache, outbox event, checkout intent, recovery row, device sequence,
  cursor, or credential is changed or deleted.

## Tests and exact results

```text
pnpm test:mobile-mob-13-release-inputs
PASS — 5 tests, 0 failures

pnpm test:phase-23-android-hardening
PASS — 6 tests, 0 failures

pnpm test:phase-24-google-play
PASS — 7 tests, 0 failures

pnpm --dir apps/mobile exec expo config --type public
PASS — non-production SDK 57 config resolves with cleartext disabled

EAS_BUILD_PROFILE=production pnpm --dir apps/mobile exec expo config --type public
EXPECTED BLOCK — exit 1, MOB-13_PRODUCTION_RELEASE_BLOCKED

pnpm mobile:typecheck
PASS

pnpm typecheck
PASS

pnpm --dir apps/mobile lint
PASS — 0 errors, 1 pre-existing warning

pnpm lint
PASS — 0 errors, 3 pre-existing warnings

pnpm mobile:export:android
PASS — Android bundle exported, 1,452 modules

node scripts/phase-24-production-release-gate.mjs
EXPECTED BLOCK — MOB-13 release inputs, A46, A47, signed AAB, testing,
pilot, and real-store evidence remain incomplete

pnpm certify:static
PARTIAL — 159 of 161 automated package commands passed. The two failures are
pre-existing repository/environment findings outside this slice:
- test:phase-14-final-recovery: retained recovery-document assertion still
  expects the superseded Supabase-authoritative wording
- test:phase-04-docker-source-connectivity: local Supabase database runtime is
  unavailable

git diff --check
PASS
```

## Certification status

MOB-13 Slice 02 implementation: **COMPLETE** after final repository validation.

MOB-13 overall: **OPEN**. This slice proves that an incomplete release cannot be
configured accidentally. It does not supply the missing business, branding,
EAS, signing, Play Console, physical-device, or merchant-pilot evidence.

A46 and A47 retain their recorded status. A48 remains `NOT_RUN`; no production
AAB or Play release candidate was created.

## Next smallest safe slice

MOB-13 Slice 03 should replace the Expo template icon/splash with approved
TINDIO brand assets and prepare the non-secret Play listing copy/asset package.
It must not mark the production release manifest `READY` until the EAS identity,
production origins, signing inspection, A47 inputs, and listing review are all
complete.
