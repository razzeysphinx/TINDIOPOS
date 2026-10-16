# MOB-13 Slice 10 - cart and inventory presentation

Status: **IMPLEMENTATION COMPLETE - PHYSICAL RESPONSIVE CERTIFICATION OPEN**

## Phase and ticket

```text
Mobile Phase 13
MOB-13 Slice 10
Cart, line editing, sale details, customer, and inventory presentation
```

## Starting commit

```text
25e66d3500f31b4a283fa39ffba163586c3a6aba
```

## Observed defect

The POS route rendered cart lines, totals, discounts, tax, dining, customer,
and inventory intelligence as a long sequence of raw controls and engineering
labels. Phones had no compact cart summary or focused cart view, tablets did
not use a catalogue/cart split, quantity editing had no stepper, and stock
estimates exposed internal scope language instead of a cashier hierarchy.

## Architecture decision

Keep `pos.tsx` as the controller for cart identity, mutation, totals, stock
refresh, customer operations, offline eligibility, and checkout custody.
Extract a stateless `CashierCartWorkspace` that receives calculated data and
existing event handlers. Below 900 dp it presents a compact summary that opens
an expandable cart workspace. At 900 dp and above it remains open beside the
catalogue as a persistent pane.

Restyle the existing cart line, modifier, and variable-price components with
the shared native primitives. Reuse `localCartLineTotalMinor`,
`calculateLocalCartTotals`, `normalizeQuantity`, and existing modifier
selection limits rather than introducing presentation-owned calculations.

The 900 dp split threshold is an implementation breakpoint pending physical
phone and tablet certification.

## Gap matrix

| Classification | Result |
| --- | --- |
| KEEP | cart identity and mutation, total calculation, local stock read model, offline eligibility, customer search/create boundary, modifier limits, variable-price validation, checkout and outbox authority |
| KEEP + HARDEN | quantity validation, fractional stepping, permission-disabled controls, line notes, modifier checkbox state, button accessibility-state composition |
| EXTEND | phone cart summary, expandable cart view, tablet split pane, totals hierarchy, sale-detail selectors, customer online/offline guidance, concise estimated-stock warnings |
| REFACTOR | cart, sale details, customer, totals, and inventory presentation extracted from `pos.tsx`; legacy source-contract tests follow their new presentation owner |
| REPLACE | raw engineering inventory labels and undifferentiated cart controls |
| REMOVE | no business capability or transaction evidence |
| NEW | `CashierCartWorkspace`, Slice 10 contract suite, and this report |

## Protected behavior

Unchanged:

- `posItemKey` remains the cart identity foundation;
- `setLineQuantity`, `setLineNote`, `removeLine`, `startConfigure`, and
  `markCartChanged` remain controller-owned handlers;
- `calculateLocalCartTotals` remains the cart total authority;
- `readCartOfflineInventoryIntelligence` remains read-only and all displayed
  stock remains explicitly estimated;
- supported-offline-cart validation still occurs before durable acceptance;
- discount, tax, dining, customer, and open-ticket state still invalidate or
  preserve checkout identity through the existing controller behavior;
- online checkout intent persistence, offline commit-before-success, outbox,
  receipt, recovery, and sync paths are unchanged.

## Changed files

```text
apps/mobile/app/(app)/pos.tsx
apps/mobile/src/features/cashier/cashier-cart-line.tsx
apps/mobile/src/features/cashier/cashier-cart-workspace.tsx
apps/mobile/src/features/cashier/cashier-editors.tsx
apps/mobile/src/ui/tindio-button.tsx
package.json
scripts/mobile-a36-unsupported-offline-cart.test.mjs
scripts/mobile-mob-13-cart-workspace.test.mjs
scripts/mobile-mob-13-ui-contract.test.mjs
scripts/phase-14-slice-01-inventory-intelligence-check.mjs
scripts/phase-14-slice-02-cart-inventory-check.mjs
docs/mobile-program/MOB_13_SLICE_10_CART_INVENTORY_PRESENTATION.md
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

Presentation-only. No transaction identity, accepted sale, payment, receipt,
inventory effect, outbox event, recovery row, cache row, authorization grant,
device sequence, cursor, credential, or tenant boundary is changed or deleted.
The unsupported-offline-cart warning moved into the cart presentation, while
the defensive rejection remains before `createOfflineCashSale`.

## Tests and exact results

```text
pnpm test:mobile-mob-13-cart-workspace
PASS - 5 tests, 0 failures

pnpm test:mobile-a36-unsupported-offline-cart
PASS - 11 tests, 0 failures

node --test scripts/phase-14-slice-01-inventory-intelligence-check.mjs scripts/phase-14-slice-02-cart-inventory-check.mjs
PASS - 2 tests, 0 failures

pnpm test:mobile-mob-13-ui-contract
PASS - 4 tests, 0 failures

pnpm test:mobile-mob-13-catalogue
PASS - 4 tests, 0 failures

pnpm test:phase-13-native-cashier-parity
PASS - 1 test, 0 failures

pnpm test:phase-09-local-first
PASS - 1 test, 0 failures

pnpm test:mobile-catalog-cache
PASS - 2 tests, 0 failures

pnpm test:mobile-physical-ui-hardening
PASS - 6 tests, 0 failures

pnpm mobile:typecheck
PASS

pnpm typecheck
PASS

pnpm --dir apps/mobile lint
PASS - 0 errors, 1 pre-existing warning

pnpm lint
PASS - 0 errors, 3 pre-existing warnings

pnpm mobile:export:android
PASS - Android bundle exported, 1,466 modules and 27 assets

git diff --check
PASS
```

The React quality review found no component declarations nested inside render,
no effect-derived presentation state, no broad barrel import, and no new data
waterfall. Totals, item count, validation, selection state, and responsive mode
are derived during render. State changes that depend on previous state use
functional updates.

## Physical evidence

```text
Physical phone cart: NOT_RUN
Physical tablet split pane: NOT_RUN
Large text / keyboard / TalkBack: NOT_RUN
Fractional quantity hardware workflow: NOT_RUN
Low-end performance: NOT_RUN
A49: remains BLOCKED
```

This slice supplies implementation, source-contract, type, lint, and Android
export evidence only. It does not claim that the 900 dp breakpoint, expanded
phone cart, keyboard reachability, focus order, or large-text behavior is
physically certified.

## Remaining limitations

- The phone cart uses an expandable dedicated workspace; final sheet behavior
  and physical ergonomics remain subject to Slice 13 certification.
- The 900 dp catalogue/cart split requires physical tablet validation.
- Customer creation remains online-only and cached customer search remains the
  offline boundary.
- Inventory values remain estimates and never replace cloud authority.
- Ticket presentation remains unchanged for the bounded operational-screen
  slice.
- Tender, checkout, and receipt-result presentation remains unchanged and is
  intentionally outside this slice.
- Candidate branding remains unapproved.

## Commit

```text
PENDING - record after final validation
```

## Next smallest safe slice

MOB-13 Slice 11 - tender, checkout, and receipt-result presentation. Preserve
cash calculation, payment permissions, stable online checkout identity,
offline commit-before-success, ambiguous retry behavior, receipt immutability,
and recovery custody.
