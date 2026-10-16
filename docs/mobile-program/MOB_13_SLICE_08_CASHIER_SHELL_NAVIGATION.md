# MOB-13 Slice 08 — cashier shell, navigation, and readiness

Status: **IMPLEMENTATION COMPLETE — PHYSICAL RESPONSIVE CERTIFICATION OPEN**

## Phase and ticket

```text
Mobile Phase 13
MOB-13 Slice 08
Cashier shell, task navigation, readiness, and diagnostics boundary
```

## Starting commit

```text
c30d1cb3ddc8dbbe0596f82231c99819f25a44c8
```

## Observed defect

The cashier home preserved correct gates and custody behavior but still mixed
raw mode labels, inline styling, roles, device preparation, navigation, and
support information in one undifferentiated scroll. Readiness was technically
accurate but not expressed as clear cashier guidance. Phone and tablet widths
shared the same single-column presentation.

## Architecture decision

Keep the existing business-context controller, feature gates, navigation
model, Expo Router paths, preparation component, organization switching,
custody-aware sign-out, and direct-route diagnostic guard. Extract only three
stateless presentation components:

- a branded terminal identity/readiness header;
- a six-state readiness guidance panel;
- an accessible cashier task card.

Adopt the Slice 07 primitives on the home route. Use a 720 dp shell threshold
to move from one column to a bounded two-column home workspace while allowing
the task grid and header to wrap. This is an implementation breakpoint, not
final physical certification; Slice 13 must validate and adjust it against the
required device classes.

The authenticated layout remains the global safe-area and permission boundary.
The home screen uses `TindioScreen` with empty edges so safe-area padding is not
applied twice.

## Gap matrix

| Classification | Result |
| --- | --- |
| KEEP | business/session/device providers, navigation paths and gates, `DeviceSetup`, organization reload, custody guard, sign-out behavior, Expo Router stack, sync/recovery visibility |
| KEEP + HARDEN | manager/support route guard, context failure recovery, minimum touch targets, accessibility labels/hints, long-label wrapping |
| EXTEND | branded terminal header, plain-language connection label, six-state guidance, phone/tablet workspace, shared primitive adoption |
| REFACTOR | inline home presentation into three stateless cashier components |
| REPLACE | raw engineering mode wording and role list on the routine cashier home |
| REMOVE | no capability; engineering details remain available through authorized diagnostics |
| NEW | terminal header, readiness panel, task card, responsive shell contract coverage, and this report |

## Readiness presentation

The shell keeps these states materially distinct:

| State | Cashier presentation |
| --- | --- |
| `READY_OFFLINE` | register ready; saved store data remains available if connection drops |
| `EXPIRING_SOON` | proactive reconnect deadline and supported cash-sale guidance |
| `EXPIRED_RECONNECT_REQUIRED` | new offline sales paused; accepted receipts and saved work retained |
| `PREPARATION_REQUIRED` | connect and finish terminal assignment |
| `RECOVERING` | saved work and store updates are being reconciled; no early completion claim |
| `SYNC_REVIEW` | direct path to review; nothing deleted or hidden |

Connection labels are cashier-facing: connected to TINDIO, using the store
connection, reconnecting saved work, review required, or using saved store
data. UUIDs, SQLite, cursor, checkpoint, and idempotency language are not shown
on the home route.

## Protected components

Unchanged:

- all checkout/catalogue/cart/tender code and test IDs in `pos.tsx`;
- offline authorization derivation and final checkout validation;
- transaction-custody checks before organization switching and sign-out;
- support permissions `devices.manage` and `settings.manage` at both navigation
  and direct-route boundaries;
- local database, outbox, recovery, receipt, device-sequence, sync, and tenant
  isolation behavior;
- POS v2 and Supabase Auth contracts.

## Changed files

```text
apps/mobile/app/(app)/index.tsx
apps/mobile/src/features/cashier/cashier-terminal-header.tsx
apps/mobile/src/features/cashier/cashier-readiness-panel.tsx
apps/mobile/src/features/cashier/cashier-task-card.tsx
scripts/mobile-mob-13-cashier-home.test.mjs
docs/mobile-program/MOB_13_SLICE_08_CASHIER_SHELL_NAVIGATION.md
```

## Database, SQLite, and API compatibility

```text
Neon/PostgreSQL migration: NONE
SQLite migration/reset: NONE
POS v2 API change: NONE
Supabase Auth change: NONE
Expo route change: NONE
New dependency: NONE
```

## Security and transaction-custody impact

Presentation-only. The authenticated layout still fails closed while support
access is loading and redirects unauthorized direct diagnostic routes. Sync and
recovery remain visible to every cashier. No transaction identity, accepted
sale, payment, receipt, inventory effect, outbox event, recovery row, cache,
authorization grant, sequence, cursor, or credential is changed or deleted.

## Tests and exact results

```text
pnpm test:mobile-mob-13-cashier-home
PASS — 5 tests, 0 failures

pnpm test:mobile-mob-13-ui-contract
PASS — 4 tests, 0 failures

pnpm mobile:typecheck
PASS

pnpm typecheck
PASS

pnpm --dir apps/mobile lint
PASS — 0 errors, 1 pre-existing warning

pnpm lint
PASS — 0 errors, 3 pre-existing warnings

pnpm test:phase-06-native-shells
PASS — 1 test, 0 failures

pnpm test:phase-13-native-cashier-parity
PASS — 1 test, 0 failures

pnpm test:mobile-offline-authorization-expiry
PASS — 14 tests, 0 failures

pnpm test:mobile-physical-ui-hardening
PASS — 6 tests, 0 failures

pnpm mobile:export:android
PASS — Android bundle exported, 1,463 modules and 27 assets

git diff --check
PASS
```

The React quality review found no new fetch waterfall, effect, nested component,
mutable module state, or broad barrel import. Width is derived directly during
render; interaction work remains in event handlers. New presentation
components are stateless.

## Physical evidence

```text
Physical phone shell: NOT_RUN
Physical tablet shell: NOT_RUN
Large text / keyboard / TalkBack: NOT_RUN
A49: remains BLOCKED
```

This slice provides implementation and source/build evidence only. It does not
claim that the 720 dp breakpoint, wrapping, focus order, contrast, or large-text
behavior is physically certified.

## Remaining limitations

- `DeviceSetup` retains its older presentation and will need bounded primitive
  adoption when preparation flow convergence is scheduled.
- The home shell does not become a persistent header inside POS; the POS shell
  is addressed with the catalogue/cart slices.
- Candidate branding remains unapproved.
- Physical phone/tablet, orientation, large-text, keyboard, TalkBack, and
  low-end performance evidence remains open.
- Production release and all existing external/hardware blockers are unchanged.

## Commit

```text
PENDING — record after final validation
```

## Next smallest safe slice

MOB-13 Slice 09 — catalogue, local search, barcode/SKU and camera entry,
category filtering, and product selection presentation. Preserve local-first
queries, duplicate scan suppression, variable-price/modifier behavior, and all
checkout/custody paths. Do not combine cart or tender redesign into Slice 09.
