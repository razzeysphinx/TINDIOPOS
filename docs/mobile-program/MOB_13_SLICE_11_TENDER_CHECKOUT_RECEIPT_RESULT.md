# MOB-13 Slice 11 - tender, checkout, and receipt result

Status: **IMPLEMENTATION COMPLETE - PHYSICAL ACCEPTANCE CERTIFICATION OPEN**

## Phase and ticket

```text
Mobile Phase 13
MOB-13 Slice 11
Tender, checkout, and receipt-result presentation
```

## Starting commit

```text
220f1a5f73b65b7b6cc0e5cace5817b8ac10f402
```

## Observed defect

The native cashier exposed payment as raw text, an unstyled cash field, two
equally weighted checkout buttons, internal checkout-operation copy, and
success messages embedded in the continuing sale form. Local and server
receipts then used separate raw layouts, making provisional evidence and an
official receipt look unrelated.

## Architecture decision

Keep `pos.tsx` as the authority for payment eligibility, stable checkout
identity, online intent persistence, offline acceptance, transaction custody,
and synchronization. Extract a focused `CashierTenderPanel` that receives
derived readiness and disabled states and invokes the existing controller
handlers. Present an explicit amount due, cash received, change due, one
primary acceptance action for the current mode, and a durable result state.

Use a shared `CashierReceiptSummary` for both immutable local snapshots and
server receipt details. The routes continue to own authorized data loading,
copy preparation, delivery, refunds, and idempotency identities.

## Gap matrix

| Classification | Result |
| --- | --- |
| KEEP | cash calculation, payment permissions, stable checkout key, durable online intent, offline sale transaction, outbox sync, immutable receipt reads, tenant/store scope, refund and delivery APIs |
| KEEP + HARDEN | duplicate-submit guards, ambiguous online-result guidance, short-tender validation, busy/disabled accessibility state, provisional-versus-official language |
| EXTEND | focused tender hierarchy, received/change presentation, durable acceptance result, replay-safe confirmation, shared itemized receipt summary |
| REFACTOR | tender and result presentation extracted from `pos.tsx`; local and online receipt headers/items/totals/payment converge on one component; source contracts follow their presentation owner |
| REPLACE | raw checkout operation copy, all-caps payment actions, raw success strings, and unrelated receipt layouts |
| REMOVE | no business capability, accepted evidence, or recovery path |
| NEW | `CashierTenderPanel`, `CashierReceiptSummary`, Slice 11 contract suite, and this report |

## Protected behavior

Unchanged:

- online checkout intent is persisted before `checkoutPosV2` delivery;
- retries reuse the original immutable payload and idempotency key;
- unresolved online intent blocks offline fallback;
- offline success is shown only after `createOfflineCashSale` returns its
  committed event and immutable snapshot;
- submit guards prevent concurrent local or online acceptance;
- server acknowledgment occurs before the official result is shown;
- local receipts remain immutable, tenant scoped, and assigned-store scoped;
- provisional receipt copy jobs remain separate durable records;
- server delivery and refund identities and handlers remain route owned;
- no custody, cache, receipt, outbox, credential, sequence, or cursor deletion
  path was added.

## Changed files

```text
apps/mobile/app/(app)/local-receipt/[eventId].tsx
apps/mobile/app/(app)/pos.tsx
apps/mobile/app/(app)/receipt/[receiptId].tsx
apps/mobile/src/features/cashier/cashier-receipt-summary.tsx
apps/mobile/src/features/cashier/cashier-tender-panel.tsx
package.json
scripts/mobile-local-receipts.test.mjs
scripts/mobile-mob-13-tender-receipt.test.mjs
scripts/mobile-online-checkout-intent.test.mjs
scripts/mobile-physical-ui-hardening.test.mjs
scripts/phase-08-cold-start-offline-check.mjs
scripts/phase-10-durable-outbox-check.mjs
docs/mobile-program/MOB_13_SLICE_11_TENDER_CHECKOUT_RECEIPT_RESULT.md
```

## Database, SQLite, and API compatibility

```text
Neon/PostgreSQL migration: NONE
SQLite migration/reset: NONE
SQLite query/schema change: NONE
POS v2 API change: NONE
Supabase Auth change: NONE
Expo route change: NONE
New dependency: NONE
```

## Security and transaction-custody impact

Presentation-only. Acceptance and receipt data are projected from the existing
controller and immutable receipt models. Neither presentation component can
call checkout, enqueue, synchronization, refund, delivery, or database
mutation functions. Stable online intent and offline commit-before-success
boundaries remain in their existing owners.

## Tests and exact results

```text
pnpm test:mobile-mob-13-tender-receipt
PASS - 3 tests, 0 failures

pnpm test:mobile-online-checkout-intent
PASS - 5 tests, 0 failures

pnpm test:mobile-local-receipts
PASS - 5 tests, 0 failures

pnpm test:mobile-physical-ui-hardening
PASS - 6 tests, 0 failures

pnpm test:phase-08-cold-start-offline
PASS - 1 test, 0 failures

pnpm test:phase-10-durable-outbox
PASS - 1 test, 0 failures

pnpm test:mobile-a36-unsupported-offline-cart
PASS - 11 tests, 0 failures

pnpm test:mobile-offline-authorization-expiry
PASS - 14 tests, 0 failures

pnpm test:mobile-outbox-coordinator
PASS - 5 tests, 0 failures

pnpm test:mobile-outbox-recovery
PASS - 5 tests, 0 failures

pnpm test:mobile-shift-custody-leases
PASS - 6 tests, 0 failures

pnpm test:mobile-shift-finalization
PASS - 6 tests, 0 failures

pnpm test:mobile-request-timeout
PASS - 4 tests, 0 failures

pnpm test:mobile-foreground-recovery
PASS - 6 tests, 0 failures

pnpm test:phase-13-native-cashier-parity
PASS - 1 test, 0 failures

pnpm test:phase-18-production-contract
PASS - 1 test, 0 failures

pnpm mobile:typecheck
PASS

pnpm typecheck
PASS

pnpm --dir apps/mobile lint
PASS - 0 errors, 1 pre-existing warning

pnpm lint -- <Slice 11 TSX files>
PASS - 0 errors, 0 warnings

pnpm lint
PASS - 0 errors, 3 pre-existing/generated warnings

pnpm mobile:export:android
PASS - Android bundle exported, 1,468 modules and 27 assets

git diff --check
PASS
```

The React quality review found no presentation-owned effects, no component
declarations inside render, no barrel imports, and no new network waterfall.
Eligibility and result presentation are derived during render; async authority
remains in the routes. New inputs, actions, results, and receipt headings have
accessible labels, roles, live regions, and busy/disabled state through the
shared primitives.

## Physical evidence

```text
Physical phone tender: NOT_RUN
Physical tablet tender: NOT_RUN
Offline acceptance/result on device: NOT_RUN
Ambiguous online retry on device: NOT_RUN
Receipt copy/delivery/refund on device: NOT_RUN
Large text / keyboard / TalkBack: NOT_RUN
A49: remains BLOCKED
```

This slice provides implementation, transaction-custody regression, static
quality, and Android export evidence only. It does not certify payment or
receipt ergonomics on physical hardware.

## Remaining limitations

- Physical phone and tablet layout, keyboard, large-text, and TalkBack checks
  remain for Slice 13/14.
- Receipt delivery and refund controls retain their existing presentation and
  are included in the broader operational-screen Slice 12.
- Printing remains explicitly unavailable until a supported adapter enters
  scope; preparing a duplicate does not claim physical printing.
- Offline electronic/card payments remain disabled.
- Candidate branding remains unapproved.

## Commit

```text
PENDING - record after final validation
```

## Next smallest safe slice

MOB-13 Slice 12 - customers, tickets, receipt operations, shifts, transfers,
time clock, recovery, settings, and diagnostics. Preserve route permissions,
online/offline boundaries, durable custody, stable operation identities, and
all existing recovery actions.
