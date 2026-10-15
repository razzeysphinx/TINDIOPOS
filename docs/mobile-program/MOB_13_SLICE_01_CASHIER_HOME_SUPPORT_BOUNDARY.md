# MOB-13 Slice 01 — branded cashier home and support boundary

## Phase and ticket

```text
Mobile Phases 06, 13, 23, and 24
MOB-13 Slice 01
Cashier navigation language and authorized support diagnostics
```

## Starting commit

```text
917cfbc712fcc7769e82298b3ac8a59cf17c4ab7
```

## Observed defect

The signed-in Android home exposed raw route fragments such as `pos`,
`sync-status`, `offline-payments`, and `production-readiness`. Hardware,
payment-policy, and release-diagnostic screens appeared in every employee's
navigation. This was implementation-oriented rather than cashier-oriented and
did not satisfy the requirement to retain diagnostics behind an authorized
support surface.

## Architecture decision

Preserve Expo Router and every existing workflow. Add a typed presentation
model that maps existing routes to task-based cashier labels and descriptions,
while continuing to derive business workflow visibility from the existing
feature and permission gates.

Keep Sync and recovery visible to cashiers because unresolved transaction
custody must remain actionable. Restrict Hardware support, Payment safety, and
Release diagnostics to employees holding the existing `devices.manage` or
`settings.manage` permission. Enforce the same boundary at the app layout so a
direct route cannot bypass navigation visibility.

## Gap matrix

| Classification | Decision |
| --- | --- |
| KEEP | Expo Router, business context, cashier feature gates, offline readiness, organization switching, device enrollment, and transaction-custody sign-out guard |
| KEEP + HARDEN | Support diagnostics use existing manager permissions at navigation and direct-route boundaries |
| EXTEND | Branded TINDIO POS home, task descriptions, accessible action cards, and cashier-facing connection language |
| REFACTOR | Raw route array becomes a typed navigation presentation model |
| REPLACE | Route-fragment labels and `Backend V1 connected` developer wording |
| REMOVE | Unconditional cashier links to hardware, payment-policy, and release-diagnostic screens |
| NEW | MOB-13 cashier-home regression suite and this evidence report |

## Changed files

- typed cashier navigation presentation policy;
- signed-in Android home screen;
- authenticated app-layout support route guard;
- MOB-13 behavioral/source-contract suite;
- package test command and this evidence report.

## Database, SQLite, and API compatibility

```text
Neon migration: NONE
SQLite migration/reset: NONE
POS v2 API change: NONE
Supabase Auth change: NONE
Expo route path change: NONE
```

## Security and transaction-custody impact

- Authorization uses existing provider-neutral bootstrap permissions.
- Restricted support pages fail closed during context loading and redirect
  unauthorized employees to the cashier home.
- Sync and recovery remains available to cashiers; the restriction does not
  hide accepted receipts, pending outbox entries, checkout intents, recovery
  records, or reconciliation controls.
- Organization switching and sign-out retain the existing transaction-custody
  guard.
- No transaction identity, device sequence, cursor, credential, or local row
  is changed or deleted.

## Tests and exact results

```text
pnpm test:mobile-mob-13-cashier-home
PASS — 3 tests, 0 failures

pnpm test:phase-06-native-shells
PASS — 1 test, 0 failures

pnpm test:phase-13-native-cashier-parity
PASS — 1 test, 0 failures

pnpm mobile:typecheck
PASS

pnpm typecheck
PASS

pnpm --dir apps/mobile lint
PASS — 0 errors, 1 pre-existing warning

pnpm lint
PASS — 0 errors, 3 pre-existing warnings

pnpm test:phase-23-android-hardening
PASS — 6 tests, 0 failures

pnpm test:phase-24-google-play
PASS — 6 tests, 0 failures

pnpm test:mobile-physical-ui-hardening
PASS — 6 tests, 0 failures

pnpm test:mobile-offline-authorization-expiry
PASS — 14 tests, 0 failures

pnpm mobile:export:android
PASS — Android bundle exported, 1,452 modules

pnpm certify:static
PARTIAL — 158 of 160 automated package commands passed. The two failures are
pre-existing repository/environment findings outside this slice:
- test:phase-14-final-recovery: retained recovery-document assertion still
  expects the superseded Supabase-authoritative wording
- test:phase-04-docker-source-connectivity: local Supabase database runtime is
  unavailable

git diff --check
PASS
```

## Certification status

MOB-13 Slice 01 implementation: **COMPLETE**.

MOB-13 overall: **OPEN**. This source-contract and export work does not replace
A49 physical phone/tablet, large-text, keyboard, and TalkBack evidence.

A46, A47, and A48 retain their previously recorded status. No production AAB,
signing, Play upload, reviewer walkthrough, public policy deployment, or
merchant pilot is claimed.

## Next smallest safe slice

Continue MOB-13 with a production release-input audit and fail-closed build
contract: verify EAS owner/project linkage, production endpoint embedding,
version/signing metadata, listing asset inventory, and public policy/support
inputs. Keep A48 `NOT_RUN` until the actual production-signed Phase 23/24
release candidate exists.
