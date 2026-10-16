# MOB-13 Slice 12 - supporting cashier workflows

Status: **IMPLEMENTATION COMPLETE - PHYSICAL ACCEPTANCE CERTIFICATION OPEN**

## Phase and ticket

```text
Mobile Phase 13
MOB-13 Slice 12
Supporting cashier workflows and authorized diagnostics
```

## Starting commit

```text
a60e5d66f8b65a090d633b4710b54071b3983806
```

## Observed defect

Customer, ticket, receipt, shift, transfer, attendance, sync, settings, and
support routes still presented controller state as raw text fields and buttons.
Online-only restrictions, empty states, selected records, pending operations,
and support-only diagnostics had no shared hierarchy. A45 certification also
was not included in the authenticated layout's manager/support route guard.

## Architecture decision

Add a small shared native operational vocabulary for workspace headers,
sections, selectable list rows, and key/value facts. Keep every existing route
as the owner of permissions, feature gates, API calls, stable operation
identities, local reads, custody checks, and recovery decisions.

Use shared buttons, inputs, feedback, cards, status badges, and screens to make
online-only boundaries, loading, empty, restriction, pending, success, and
unknown-result states explicit. Preserve sync/recovery detail and label it as
authorized diagnostics rather than deleting engineering evidence.

## Gap matrix

| Classification | Result |
| --- | --- |
| KEEP | API handlers, feature gates, permission checks, tenant/store filters, local receipt reads, ticket and transfer contracts, shift finalization, outbox recovery, Store Hub custody checks, public policy links |
| KEEP + HARDEN | stable cash/attendance/transfer/refund/delivery identities, duplicate-submit guards, A45 support-route guard, selected-state accessibility, online-only explanations |
| EXTEND | shared workspace header, section, list-row, and key/value primitives; empty/loading/restriction feedback; current-state time-clock action |
| REFACTOR | customers, tickets, receipt history/actions, shifts, transfers, time clock, settings, sync overview, hardware/payment/production/A45 diagnostics |
| REPLACE | raw all-caps engineering presentation and undifferentiated buttons/fields |
| REMOVE | no business capability, receipt evidence, transaction custody, recovery action, or diagnostic record |
| NEW | `tindio-workspace.tsx`, Slice 12 contract suite, and this report |

## Protected behavior

Unchanged:

- customer cloud search/create and device-cache boundaries;
- receipt tenant and assigned-store scope;
- official receipt delivery/refund APIs and idempotency keys;
- shift open/close permissions and custody-first finalization;
- cash-movement idempotency reuse after unknown results;
- ticket cancel/split/merge/move contracts and online-only behavior;
- transfer line quantities, discrepancy notes, operation ID reuse, and
  authoritative online receipt;
- attendance employee discovery and stable request ID retry;
- outbox recovery authorization, reauthentication, reviewed retry, device
  sequence, checkpoint, reconciliation, and Store Hub/cloud ACK separation;
- Store Hub removal remains blocked while custody cannot be released;
- hardware adapters remain separate from transaction authority;
- offline electronic payments remain fail closed;
- upgrade and A45 diagnostics remain non-transaction-authoritative.

## Changed files

```text
apps/mobile/app/(app)/_layout.tsx
apps/mobile/app/(app)/a45-certification.tsx
apps/mobile/app/(app)/customers.tsx
apps/mobile/app/(app)/hardware.tsx
apps/mobile/app/(app)/offline-payments.tsx
apps/mobile/app/(app)/production-readiness.tsx
apps/mobile/app/(app)/receipt/[receiptId].tsx
apps/mobile/app/(app)/receipts.tsx
apps/mobile/app/(app)/settings.tsx
apps/mobile/app/(app)/shift.tsx
apps/mobile/app/(app)/sync-status.tsx
apps/mobile/app/(app)/tickets.tsx
apps/mobile/app/(app)/time-clock.tsx
apps/mobile/app/(app)/transfers.tsx
apps/mobile/src/ui/tindio-workspace.tsx
package.json
scripts/mobile-a36-unsupported-offline-cart.test.mjs
scripts/mobile-mob-12-hardware-scope.test.mjs
scripts/mobile-mob-13-supporting-workflows.test.mjs
scripts/mobile-physical-ui-hardening.test.mjs
scripts/phase-13-native-cashier-parity-check.mjs
scripts/phase-14-offline-inventory-intelligence-check.mjs
scripts/phase-15-slice-02-mobile-hub-config-check.mjs
scripts/phase-16-slice-03-isolated-diagnostics-check.mjs
scripts/phase-19-native-hardware-check.mjs
docs/mobile-program/MOB_13_SLICE_12_SUPPORTING_CASHIER_WORKFLOWS.md
```

## Database, SQLite, and API compatibility

```text
Neon/PostgreSQL migration: NONE
SQLite migration/reset: NONE
SQLite query/schema change: NONE
POS v2 API change: NONE
Supabase Auth change: NONE
Expo route added/removed: NONE
Existing route guard extended: A45 certification diagnostics
New dependency: NONE
```

## Security and transaction-custody impact

Presentation and activation hardening only. A45 certification now requires the
same `devices.manage` or `settings.manage` support boundary as other diagnostic
routes. No permission was weakened. Pending-state guards prevent duplicate UI
activation while all unknown-result paths retain their original identity.
No custody, outbox, receipt, credential, cache, sequence, checkpoint, or cursor
deletion path was added.

## Tests and exact results

```text
pnpm test:mobile-mob-13-supporting-workflows
PASS - 4 tests, 0 failures

pnpm test:phase-13-native-cashier-parity
PASS - 1 test, 0 failures

pnpm test:mobile-mob-12-hardware-scope
PASS - 3 tests, 0 failures

pnpm test:mobile-physical-ui-hardening
PASS - 6 tests, 0 failures

pnpm test:mobile-a36-unsupported-offline-cart
PASS - 11 tests, 0 failures

pnpm test:mobile-online-checkout-intent
PASS - 5 tests, 0 failures

pnpm test:mobile-offline-authorization-expiry
PASS - 14 tests, 0 failures

pnpm test:mobile-outbox-coordinator
PASS - 5 tests, 0 failures

pnpm test:mobile-outbox-recovery
PASS - 5 tests, 0 failures

pnpm test:mobile-local-receipts
PASS - 5 tests, 0 failures

pnpm test:mobile-shift-custody-leases
PASS - 6 tests, 0 failures

pnpm test:mobile-shift-finalization
PASS - 6 tests, 0 failures

pnpm test:mobile-request-timeout
PASS - 4 tests, 0 failures

pnpm test:mobile-mob-11-release-scope
PASS - 3 tests, 0 failures

pnpm test:mobile-a45-operational-alerts
PASS - 6 tests, 0 failures

pnpm test:mobile-receipt-cache-scope
PASS - 3 tests, 0 failures

pnpm test:mobile-mob-13-tender-receipt
PASS - 3 tests, 0 failures

pnpm test:phase-06-native-shells
PASS - 1 test, 0 failures

pnpm test:phase-07-native-sqlite-complete
PASS - 1 test, 0 failures

pnpm test:phase-08-cold-start-offline
PASS - 1 test, 0 failures

pnpm test:phase-11-device-sequence-checkpoints
PASS - 1 test, 0 failures

pnpm test:phase-16-isolated-device-mode
PASS - 1 test, 0 failures

pnpm test:phase-18-production-contract
PASS - 1 test, 0 failures

pnpm test:phase-23-android-hardening
PASS - 6 tests, 0 failures

pnpm test:phase-24-google-play
PASS - 7 tests, 0 failures

node --test <Phase 14/15/16/19 compatibility set>
PASS - 6 tests, 0 failures after presentation-owner contract updates

pnpm mobile:typecheck
PASS

pnpm typecheck
PASS

pnpm --dir apps/mobile lint
PASS - 0 errors, 1 pre-existing warning

pnpm lint
PASS - 0 errors, pre-existing/generated warnings only

pnpm mobile:export:android
PASS - Android bundle exported, 1,469 modules and 27 assets

git diff --check
PASS
```

The React quality review found no effect-derived presentation state, no
component declarations inside route renders, and no barrel imports. Selected
records, permissions, online status, current attendance action, and validation
states are derived during render. Existing data-loading effects remain scoped
to their original business dependencies.

## Physical evidence

```text
Supporting workflows on physical phone: NOT_RUN
Supporting workflows on physical tablet: NOT_RUN
Keyboard and large-text behavior: NOT_RUN
TalkBack selection/action behavior: NOT_RUN
Low-end workflow performance: NOT_RUN
A49: remains BLOCKED
```

## Remaining limitations

- Sync status retains detailed recovery and certification evidence because it
  cannot be hidden or deleted; final responsive grouping is part of Slice 13.
- Physical confirmation, destructive-action ergonomics, focus order, keyboard
  reachability, and large-text behavior remain open.
- Receipt printing and external peripherals remain outside v1 support.
- Offline electronic/card payments remain disabled.
- Candidate branding remains unapproved.

## Commit

```text
PENDING - record after final validation
```

## Next smallest safe slice

MOB-13 Slice 13 - responsive and accessibility hardening across compact phone,
standard phone, compact tablet, and tablet layouts, including large text,
keyboard visibility, TalkBack semantics, reduced motion, and low-end-device
performance evidence preparation.
