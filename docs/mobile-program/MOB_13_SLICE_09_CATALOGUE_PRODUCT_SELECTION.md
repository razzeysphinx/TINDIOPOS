# MOB-13 Slice 09 - catalogue and product selection

Status: **IMPLEMENTATION COMPLETE - PHYSICAL SCANNER CERTIFICATION OPEN**

## Phase and ticket

```text
Mobile Phase 13
MOB-13 Slice 09
Catalogue, local search, scanner entry, filtering, and product selection
```

## Starting commit

```text
85a3070d3d4f0bec1e8b7d65c6912fe22b5a2780
```

## Observed defect

The POS route exposed the correct local-first search and selection behavior,
but rendered it as an undifferentiated collection of raw text fields and
pressables. Loading, empty, and catalogue-read failure states were absent;
category selection was not announced; product capabilities were embedded in
one long text line; and the camera scanner lacked a clear target and consistent
permission guidance.

## Architecture decision

Keep `pos.tsx` as the behavior controller and extract only a stateless
`CashierCatalogue` presentation component. The controller still owns local
queries, barcode/SKU lookup, scan acceptance, modifier and variable-price
configuration, stock estimates, and cart mutation. The catalogue presents
search, manual and camera entry, category tabs, load/error/empty feedback, and
responsive product cards through the Slice 07 primitives.

At 600 dp and above, product cards may share a row. Below that threshold they
remain full width. This is an implementation breakpoint pending physical phone
and tablet certification.

## Gap matrix

| Classification | Result |
| --- | --- |
| KEEP | local SQLite catalogue queries, pagination cap, barcode/SKU lookup, HID and camera duplicate suppression, modifier/variable-price routing, fractional quantity signal, stock refresh, cart and checkout authority |
| KEEP + HARDEN | manual entry when camera permission is denied, camera cancellation, minimum category target, accessibility roles/state/labels, scan progress announcement |
| EXTEND | explicit loading, empty, and error states; responsive product cards; plain-language offline availability and product capability signals |
| REFACTOR | catalogue presentation extracted from `pos.tsx`; A37 source contract follows the extracted manual-entry component |
| REPLACE | engineering-facing SQLite/store identifiers and raw product rows on the routine POS surface |
| REMOVE | no capability |
| NEW | `CashierCatalogue`, Slice 09 contract suite, and this report |

## Protected behavior

Unchanged:

- `searchLocalCatalog`, `lookupLocalBarcode`, and `lookupLocalSku` remain the
  only catalogue read paths;
- camera and HID acceptance guards still acquire synchronously before lookup
  and release after completion;
- product selection still enters the existing modifier or variable-price flow
  when required;
- stock estimates, cart mutation, discounts, taxes, dining, payment, checkout,
  receipt, outbox, recovery, and custody behavior remain in `pos.tsx`;
- camera denial leaves manual barcode and SKU entry available;
- external scanner support is still described as uncertified, not supported.

## Changed files

```text
apps/mobile/app/(app)/pos.tsx
apps/mobile/src/features/cashier/cashier-catalogue.tsx
apps/mobile/src/features/hardware/camera-barcode-scanner.tsx
package.json
scripts/mobile-a37-hardware-input.test.mjs
scripts/mobile-mob-13-catalogue.test.mjs
docs/mobile-program/MOB_13_SLICE_09_CATALOGUE_PRODUCT_SELECTION.md
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
Catalogue failures now produce cashier-facing feedback without bypassing any
checkout or custody gate.

## Tests and exact results

```text
pnpm test:mobile-mob-13-catalogue
PASS - 4 tests, 0 failures

pnpm test:mobile-a37-hardware-input
PASS - 5 tests, 0 failures

pnpm test:mobile-mob-13-ui-contract
PASS - 4 tests, 0 failures

pnpm test:mobile-catalog-cache
PASS - 2 tests, 0 failures

pnpm test:phase-09-local-first
PASS - 1 test, 0 failures

pnpm test:phase-13-native-cashier-parity
PASS - 1 test, 0 failures

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
PASS - Android bundle exported, 1,465 modules and 27 assets

git diff --check
PASS
```

The React quality review found no new effect-driven interaction, nested
component declaration, mutable module state, broad barrel import, or data
authority inside presentation code. Responsive state is derived directly from
the current window width, and interaction remains in event handlers.

## Physical evidence

```text
Physical phone catalogue: NOT_RUN
Physical tablet catalogue: NOT_RUN
Camera scan on supported device: NOT_RUN
USB/Bluetooth HID scan: BLOCKED / NOT CERTIFIED
Large text / keyboard / TalkBack: NOT_RUN
```

This slice supplies implementation, source-contract, type, lint, and Android
export evidence only. It does not claim physical scanner, responsive,
accessibility, or low-end performance certification.

## Remaining limitations

- The 600 dp grid threshold and product-card density still need physical phone
  and tablet validation.
- USB/Bluetooth HID hardware remains outside the certified release boundary.
- Camera focus, lighting, symbology coverage, and repeated-scan behavior need
  supported-device evidence.
- Cart, discounts, customer, tender, and receipt presentation remain unchanged
  and are intentionally outside this slice.
- Candidate branding remains unapproved.

## Commit

```text
PENDING - record after final validation
```

## Next smallest safe slice

MOB-13 Slice 10 - cart workspace and line editing presentation. Preserve cart
calculation, stock intelligence, modifier identity, discounts/tax/dining,
transaction custody, and checkout authority. Do not combine tender redesign
into Slice 10.
