# MOB-13 Slice 13 — responsive and accessibility hardening

## Status

```text
Repository implementation: COMPLETE
Automated source and custody regression coverage: PASS
Development browser screenshots: BLOCKED
Physical Android phone/tablet campaign: NOT_RUN
A49: remains BLOCKED
```

## Starting commit

```text
4115857a74ffaec886baa9432bee117ec9b70aea
```

## Scope

This slice hardens the converged native cashier UI for constrained windows,
orientation changes, enlarged system text, software keyboards, TalkBack
semantics, reduced-motion preferences, and the eventual physical-device
evidence campaign. It does not change sale, payment, receipt, shift, inventory,
authorization, synchronization, or recovery authority.

## Architecture decisions

### One responsive source

`apps/mobile/src/ui/tindio-responsive.ts` defines four viewport classes:

- compact phone: up to 359 dp;
- standard phone: 360–599 dp;
- compact tablet: 600–899 dp;
- tablet: 900 dp and above.

The hook uses React Native's current window width, height, and font scale so it
responds to rotation and window resizing. A font scale of 1.3 or greater
suppresses dense grids and multi-column workspaces even on wider windows. This
keeps enlarged content readable rather than treating width as the only input.

The app orientation changes from `portrait` to `default`. The next native build
will therefore honor supported device orientation instead of forcing portrait.

### Shared keyboard behavior

Scrollable `TindioScreen` routes now consistently use automatic keyboard
insets, on-drag dismissal, handled taps, and compact-phone padding. Existing
keyboard-aware sign-in, checkout, and editor surfaces remain intact.

### Accessibility preferences and semantics

The root owns one accessibility-preference subscription for screen-reader and
reduced-motion changes. Shared busy/loading indicators avoid nonessential
spinner motion when reduced motion is enabled. Feedback is announced through
polite or assertive Android live regions according to severity.

Shared cards expose headings, interactive list rows expose selected and
disabled state, decorative catalogue marks remain hidden from accessibility,
and large-text catalogue cards stop truncating names and details.
Raw route-loading spinners now use a shared indicator that shows a static text
fallback when reduced motion is enabled.

### Responsive workflow changes

- Cashier home columns and task-card grids use the shared layout result.
- POS uses a persistent cart pane only at the tablet class when large text is
  not active.
- Catalogue cards stack at large text and avoid two-line truncation.
- Cart, tender, terminal, workspace header, list, and key/value layouts stack
  on compact phones or with large text.
- The embedded POS ticket workflow now uses shared labeled inputs, buttons,
  and selected list rows.
- Sync and recovery uses the shared keyboard-aware screen and groups its raw
  support evidence into seven responsive cards without hiding any custody or
  recovery detail.

## Deterministic baseline matrix

`apps/mobile/evidence/mob-13-slice-13-baselines.json` records:

- compact phone portrait, 320 × 568;
- standard phone portrait, 390 × 844;
- standard phone keyboard-visible, 390 × 480;
- standard phone large text, 390 × 844 at font scale 2;
- compact tablet portrait, 800 × 1280;
- tablet landscape, 1280 × 800.

These are deterministic development targets, not physical certification.

An actual Expo web capture was attempted at `/sign-in` on port 8083. The server
returned HTTP 500 before the application rendered:

```text
Worker chunk not found for: .../expo-sqlite/web/worker.ts
```

No fabricated images were produced. The blocker and `BLOCKED` status are stored
in the baseline manifest. Browser capture does not substitute for Android font
scale, TalkBack, keyboard, orientation, or performance evidence.

## Compatibility and safety

```text
Neon/PostgreSQL migration: NONE
SQLite schema/reset: NONE
POS v2 API change: NONE
Authentication contract change: NONE
Checkout/outbox identity change: NONE
Recovery deletion path: NONE
```

The responsive state is derived during render. The accessibility provider owns
only operating-system preference subscriptions. No duplicated transaction
state, data-loading effect, navigation listener, or scanner listener was added.

## Automated evidence

```text
pnpm test:mobile-mob-13-responsive-accessibility
PASS — 6 tests

pnpm test:mobile-mob-13-cashier-home
PASS — 5 tests

pnpm test:mobile-mob-13-catalogue
PASS — 4 tests

pnpm test:mobile-mob-13-cart-workspace
PASS — 5 tests

pnpm test:mobile-mob-13-tender-receipt
PASS — 3 tests

pnpm test:mobile-mob-13-supporting-workflows
PASS — 4 tests

pnpm test:mobile-physical-ui-hardening
PASS — 6 tests

pnpm test:mobile-online-checkout-intent
PASS — 5 tests

pnpm test:mobile-offline-authorization-expiry
PASS — 14 tests

pnpm test:mobile-outbox-coordinator
PASS — 5 tests

pnpm test:mobile-outbox-recovery
PASS — 5 tests

pnpm test:mobile-local-receipts
PASS — 5 tests

pnpm test:mobile-shift-custody-leases
PASS — 6 tests

pnpm test:mobile-shift-finalization
PASS — 6 tests

pnpm test:mobile-request-timeout
PASS — 4 tests

pnpm test:phase-06-native-shells
PASS — 1 test

pnpm test:phase-13-native-cashier-parity
PASS — 1 test

pnpm test:phase-16-isolated-device-mode
PASS — 1 test

pnpm test:phase-22-performance
PASS — 3 tests

pnpm test:phase-23-android-hardening
PASS — 6 tests

pnpm mobile:typecheck
PASS

pnpm --dir apps/mobile lint
PASS — 0 errors, 1 pre-existing warning

pnpm typecheck
PASS

pnpm lint
PASS — 0 errors, 3 pre-existing/generated warnings

pnpm mobile:export:android
PASS — 1,472 modules and 27 assets exported to dist

git diff --check
PASS
```

## Physical evidence

```text
Low-end Android phone: NOT_RUN
Android tablet/POS form factor: NOT_RUN
Portrait/landscape rotation: NOT_RUN
Largest Android font/display scale: NOT_RUN
Software keyboard reachability: NOT_RUN
Physical keyboard/HID navigation: NOT_RUN
TalkBack spoken labels, state, and focus order: NOT_RUN
Low-end interaction and recovery timings: NOT_RUN
A49: BLOCKED
```

No `adb` executable or connected Android device is available in this
environment. Phase 22 instrumentation is present and its static contract
passes, but this is not a low-end-device measurement.

## React quality review

The React review confirmed:

- responsive and selection values are derived during render;
- the only new effect subscribes to external accessibility preferences and
  cleans up both listeners;
- no components are declared inside another component;
- shared modules use direct imports;
- no transaction or recovery state moved into presentation components.

## Remaining limitations and next slice

MOB-13 Slice 14 is the physical Android UI certification and handoff campaign.
It must use the actual candidate build and record exact build, device, Android,
viewport, orientation, font-scale, permission, store fixture, readiness, and
connection metadata. It must not promote A49 to PASS without the required
phone/tablet, keyboard, large-text, TalkBack, and low-end performance evidence.

## Commit

```text
PENDING — record after final validation
```
