# MOB-10 Slice 23 — A49 Android accessibility and constrained-screen usability

## Phase and ticket

```text
Mobile Phases 06, 13, 22–23
MOB-10 Slice 23
A49 — Low-end phone/tablet, keyboard, large text and accessibility
```

## Starting commit

```text
534455498cf1d91e974b4ee7846e942dfcc30396
```

## Observed defect

The POS checkout panel was rendered after the only `ScrollView`. Android keyboard resize or enlarged system text could therefore clip cash tender, confirmation, readiness, and recovery controls without giving the cashier a way to scroll them into view. Sign-in and the variable-price/modifier editor paths also used fixed layouts. Core cart edit controls did not consistently expose accessible names, roles, state, or 48 dp minimum targets.

## Architecture decision

Keep the existing Expo Router screens, cashier state, checkout identities, POS v2 calls, offline authorization, and custody stores. Make the existing surfaces responsive rather than introduce a second checkout experience:

- keep tender, confirmation, readiness, and recovery controls inside one keyboard-aware POS scroll surface;
- make sign-in and cashier editors keyboard-aware and scrollable;
- provide root safe-area context and top/bottom insets for signed-in and signed-out routes;
- add accessible labels, roles and checked state where meaning was previously visual only;
- use 48 dp minimum interactive/input heights on the changed core controls.

The React best-practices review guided this slice toward static shared styles, derived selection state, semantic controls, and no new effects or duplicated transaction state.

## Changed files

- `apps/mobile/app/_layout.tsx`
- `apps/mobile/app/(app)/_layout.tsx`
- `apps/mobile/app/sign-in.tsx`
- `apps/mobile/app/(app)/pos.tsx`
- `apps/mobile/src/features/cashier/cashier-cart-line.tsx`
- `apps/mobile/src/features/cashier/cashier-editors.tsx`
- `scripts/mobile-physical-ui-hardening.test.mjs`
- this closure record and its structured evidence

## Database, SQLite, and API compatibility

```text
Neon migration: NONE
SQLite migration/reset: NONE
POS v2 API change: NONE
Authentication contract change: NONE
Checkout/outbox identity change: NONE
```

## Security and transaction-custody impact

- No logout, local database reset, cache deletion, credential mutation, or custody deletion path was added.
- No sale, payment, receipt, inventory, sequence, idempotency, or synchronization logic changed.
- The original unresolved online checkout remains the only retryable operation and its recovery action now remains scroll-reachable under constrained layout.
- Disabled actions preserve their existing authorization and readiness gates.

## Acceptance status

```text
A49: BLOCKED
Repository implementation: COMPLETE
Physical low-end phone: NOT_RUN
Physical tablet: NOT_RUN
Android large-text campaign: NOT_RUN
TalkBack/screen-reader campaign: NOT_RUN
Physical keyboard/HID layout campaign: NOT_RUN
```

Static/source-contract tests prove the intended layout hierarchy and accessibility metadata. They do not prove actual rendering, focus order, spoken output, performance, or absence of clipping on the required physical device classes. No `adb` executable or connected device runtime was available during this slice, so A49 is not marked PASS.

## Tests and exact results

```text
pnpm test:mobile-physical-ui-hardening
PASS — 6 tests, 0 failures

pnpm test:phase-06-native-shells
PASS — 1 test, 0 failures

pnpm test:phase-13-native-cashier-parity
PASS — 1 test, 0 failures

pnpm test:phase-22-performance
PASS — 3 tests, 0 failures

pnpm test:phase-23-android-hardening
PASS — 6 tests, 0 failures

pnpm mobile:typecheck
PASS

pnpm --dir apps/mobile lint
PASS — 0 errors, 1 pre-existing warning

pnpm typecheck
PASS

pnpm lint
PASS — 0 errors, 3 pre-existing warnings

pnpm mobile:export:android
PASS — 1,450 modules bundled; Android Hermes bundle exported

pnpm certify:static
155/156 package commands PASS — only test:phase-04-docker-source-connectivity failed because the local Supabase source is unavailable

git diff --check
PASS
```

## Required physical closure campaign

On both a representative low-end phone and tablet, using the release-candidate build:

1. Enable the largest supported Android font/display size and TalkBack.
2. Sign in and prepare the terminal without clipped fields or actions.
3. Build a synthetic cart, edit quantity/note, enter variable price, and choose modifiers.
4. Open the soft keyboard at each text/number field and verify the active field plus cancel/continue action can be reached.
5. Verify cash tender, readiness/recovery text, offline confirmation, and online retry/confirm remain reachable without hidden controls.
6. Traverse the flow with TalkBack and verify names, roles, disabled/checked state, focus order, and status announcements.
7. Repeat with a physical keyboard/HID input and record responsiveness on the low-end device.
8. Capture screenshots/video, device/build identifiers, and exact results; use synthetic transactions only.

## Remaining limitations and next slice

A49 remains blocked on physical hardware evidence. A47 also remains blocked on production legal/contact/domain inputs. A48 remains `NOT_RUN` until the real Phase 23/24 production-signed release candidate exists.

The next independently executable slice is A50: rehearse cloud-backup restore in an isolated environment and reconcile restored financial and stock relationships without touching the historical Neon database or current production merchant data.
