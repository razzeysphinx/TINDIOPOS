# MOB-13 Slice 16 — visual density closure

Status: **IMPLEMENTATION COMPLETE — PHYSICAL PHONE/TABLET CAPTURE OPEN**

Date: 2026-10-18

## Phase and ticket

Mobile Phase 13, MOB-13 Slice 16.

## Starting commit

`90cb8e77089c0f1c4682e6d524706dfcb1a80bef`

## Observed defect

The shared responsive contract allows a two-pane cashier workspace from 720px,
but the POS route also required the 900px `tablet` class. An 800px portrait
tablet therefore received the long phone flow instead of the approved persistent
catalogue/cart split. Compact phones also retained desktop-like page and closed-
shift spacing that consumed unnecessary vertical space.

## Architecture decision

Use the existing `allowsColumns` decision as the only split-workspace authority.
Keep large-text layouts stacked, retain the existing 44px minimum touch target,
and apply smaller spacing only to the `compact-phone` class. No new responsive
system, dependency, or route was added.

## Gap matrix

| Surface | Before | Slice 16 result |
|---|---|---|
| 320px compact phone | 16px page padding and tall shift gate | 8px page padding, compact header, content-height gate |
| 390px standard phone | Stacked cashier flow | Preserved |
| 800px portrait tablet | Stacked cashier flow despite column eligibility | Persistent catalogue/cart split |
| 1280px landscape tablet | Persistent split | Preserved |
| Large-text tablet | Stacked for readability | Preserved |

## Protected components

- catalogue search, barcode lookup, and camera scan guard;
- cart identity, quantity, modifiers, and total calculations;
- online checkout intent and offline cash acceptance;
- outbox, recovery, receipt, authorization, shift, and register custody;
- tenant/store boundaries and POS v2 API contracts.

## Changed files

- `apps/mobile/app/(app)/pos.tsx`
- `apps/mobile/src/features/cashier/cashier-pos-frame.tsx`
- `apps/mobile/src/features/cashier/cashier-cart-workspace.tsx`
- `apps/mobile/evidence/mob-13-slice-16-layout-matrix.json`
- MOB-13 responsive/cart tests and the new Slice 16 density contract

## Compatibility and custody impact

```text
Neon/PostgreSQL migration: NONE
SQLite migration/reset: NONE
POS v2 API change: NONE
Supabase Auth change: NONE
Transaction identity/custody change: NONE
```

## Tests and exact results

- Slice 16 visual-density contract: **4/4 PASS**.
- MOB-13 cart, responsive/accessibility, catalogue, and tender suites:
  **18/18 PASS**.
- Mobile and root TypeScript: **PASS**.
- Mobile lint: **PASS**, 0 errors and one pre-existing warning.
- Root lint: **PASS**, 0 errors and three pre-existing warnings.
- Android Expo export: **PASS**, 1,473 modules and 27 assets.
- Full static certification: **PASS**, all 174 automated package commands.
- `git diff --check`: **PASS**.

## Evidence boundary

The owner-supplied closed/open web references and retained Slice 14 physical
screenshots informed this correction. The Expo web capture remains blocked by
the recorded `expo-sqlite` worker failure, and no prepared physical tablet was
available in this environment. The deterministic layout matrix is development
evidence only; it does not promote A49 or production certification.

## Next smallest safe slice

UI implementation is complete at the repository boundary. Resume Phase 13
physical closure with a prepared synthetic phone and tablet: capture closed and
open states, keyboard and large-text layouts, and TalkBack focus/announcement
behavior. Functional checkout, reconnect, HID, printer, signed-AAB, Play, and
merchant-pilot campaigns remain separate certification work.
