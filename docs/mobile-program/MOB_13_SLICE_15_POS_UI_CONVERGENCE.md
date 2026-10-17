# MOB-13 Slice 15 — native POS UI convergence

Status: **IMPLEMENTED — VISUAL SOURCE CHECKS COMPLETE**

Date: 2026-10-17

## Scope

Translate the approved web POS references into the native cashier surface before
resuming functional certification. This slice changes presentation and routing
to existing shift controls only. It does not change checkout authority, offline
acceptance, idempotency, receipt custody, synchronization, or database logic.

## Implemented UI states

- Added a compact native register header with ticket count, cashier identity,
  and online/offline presentation.
- Added a shift-closed gate before every selling surface. The gate includes the
  assigned store/register, permission and connectivity restrictions, and a
  route to the existing shift workspace.
- Reworked the open-shift catalogue hierarchy around the assigned store,
  product search, quick barcode entry, camera scan, category filters, and a
  centered empty-catalogue state.
- Flattened the cart and tender presentation to match the web workspace rather
  than presenting every area as an elevated dashboard card.
- Kept phone layouts stacked and collapsible while retaining the existing
  tablet catalogue/cart composition.
- Added web-aligned empty states: `No saleable products yet` and `Cart is ready`.

## Protected behavior retained

The controller still owns and calls the existing implementations for:

- local catalogue search and barcode/SKU lookup;
- camera and duplicate-scan guards;
- product configuration and cart edits;
- durable online checkout intents;
- online and offline cash acceptance;
- open tickets, customer selection, receipts, and inventory intelligence.

The new frame and presentation components contain no checkout, database,
outbox, or custody mutation code.

## Verification performed

- Mobile TypeScript check: PASS.
- Expo lint: PASS with one pre-existing unused-parameter warning in
  `production-error-boundary.tsx`.
- Focused UI and retained cashier contract checks: 22/22 PASS.
- Android Expo production export: PASS, 1,473 modules bundled.
- `git diff --check`: PASS.

No cashier functionality campaign or new physical-device certification was
performed in this slice, following the direction to finish the UI first.

## Evidence boundary

The previously captured Realme physical evidence remains preserved and outside
this focused UI change. It is not used to claim Slice 15 visual certification.

## Next UI slice

Capture the closed-shift and open-workspace states at phone and tablet widths,
then make visual-only spacing and density corrections. Functional checkout,
offline, reconnect, HID, and accessibility campaigns remain deferred until the
UI review is accepted.
