# MOB-13 Slice 07 — shared tokens and native primitives

Status: **IMPLEMENTATION COMPLETE — VISUAL ADOPTION NOT STARTED**

## Phase and ticket

```text
Mobile Phase 13
MOB-13 Slice 07
Framework-neutral semantic tokens and foundational native controls
```

## Starting commit

```text
470d2591671ab832272acdd4f88cc7305d22fad5
```

## Observed defect

The web application had a mature semantic CSS theme, while the native routes
used mostly inline styles and platform defaults. There was no framework-neutral
TINDIO presentation contract and no small native component kit through which
later cashier screens could adopt consistent spacing, type, states, targets,
and accessibility behavior.

## Architecture decision

Add one serializable TypeScript token object under the existing shared
contracts boundary. The contract imports no renderer or runtime. Adapt it
independently through CSS variables on web and a React Native theme object on
mobile.

Build only foundational native controls in this slice. Do not adopt them in a
production screen yet, modify `pos.tsx`, add a dependency, or move business
state into presentation components.

The candidate palette remains explicitly marked `candidate`; using it as the
current primitive input does not record product-owner approval.

Expo SDK 57 package versions and the current Expo documentation index were
checked before using React Native primitives and safe-area handling. No native
module, config plugin, generated native directory, navigation API, or dependency
was changed.

## Gap matrix

| Classification | Result |
| --- | --- |
| KEEP | Existing web semantic variables, Expo application, safe-area dependency, route controllers, business behavior, test IDs, and current screens |
| KEEP + HARDEN | Web theme now exposes TINDIO semantic aliases; native controls provide disabled/busy semantics, minimum targets, wrapping, and state announcements |
| EXTEND | Shared token groups, mobile renderer adapter, safe-area screen, buttons, inputs, badges, cards, and feedback states |
| REFACTOR | None; production routes intentionally retain their current presentation in Slice 07 |
| REPLACE | None |
| REMOVE | None |
| NEW | Framework-neutral contract, six native primitive modules, contract checks, and this report |

## Token contract

`src/contracts/ui/tindio-design-tokens.ts` defines:

- candidate brand and semantic surface/content/border colors;
- success, warning, danger, information, recovering, and review states;
- display, title, section, body, label, caption, and numeric type roles;
- spacing, radius, elevation, icon, minimum-target, and motion scales;
- explicit candidate brand-approval metadata.

The web adapter maps stable `--tindio-*` CSS variables to the existing theme.
The mobile adapter adds React Native shadow objects without polluting the shared
contract with renderer-specific types.

## Native primitives

| Component | Contract |
| --- | --- |
| `TindioScreen` | safe-area container, fixed or scrolling content, keyboard tap preservation, semantic background/spacing |
| `TindioButton` | primary, secondary, ghost, destructive; 48 dp minimum; busy/disabled accessibility state; wrapped label |
| `TindioInput` | visible label, inferred accessibility label, helper/error text, editable state, 48 dp minimum |
| `TindioStatusBadge` | all semantic status tones with non-color text label |
| `TindioCard` | semantic surface, border, radius, elevation, optional title/description |
| `TindioFeedback` | loading, empty, error, restriction, recovery, review; alerts/live regions; optional action |

The components are controlled and stateless. They contain no hooks, effects,
network requests, navigation, storage access, business rules, or nested
component declarations. Direct imports keep their bundle boundary analyzable.

## Protected components

Unchanged:

- `apps/mobile/app/(app)/pos.tsx` and every protected handler from Slice 06;
- session, business, terminal, authorization, and permission providers;
- SQLite schema/data and all local-first stores;
- checkout intents, operation IDs, device sequences, outbox and recovery;
- POS v2/backend paths, receipt snapshots, tenant/store filtering;
- all existing route test IDs and accessibility labels.

## Changed files

```text
src/contracts/ui/tindio-design-tokens.ts
src/app/globals.css
apps/mobile/src/ui/theme.ts
apps/mobile/src/ui/tindio-screen.tsx
apps/mobile/src/ui/tindio-button.tsx
apps/mobile/src/ui/tindio-input.tsx
apps/mobile/src/ui/tindio-status-badge.tsx
apps/mobile/src/ui/tindio-card.tsx
apps/mobile/src/ui/tindio-feedback.tsx
scripts/mobile-mob-13-ui-contract.test.mjs
package.json
docs/mobile-program/MOB_13_SLICE_07_SHARED_TOKENS_NATIVE_PRIMITIVES.md
```

The Slice 06 expected boundary was followed exactly.

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

Presentation-only. No merchant data, credential, transaction identity, sale,
payment, receipt, inventory record, outbox event, checkout intent, recovery
row, sequence, cursor, or authorization grant is read, changed, or deleted.
The primitives cannot accept or finalize a checkout.

## Tests and exact results

```text
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

pnpm mobile:export:android
PASS — Android bundle exported, 1,453 modules and 27 assets

git diff --check
PASS
```

The React component quality review found no new data-fetch waterfall, hook,
effect, mutable shared state, nested component, renderer coupling, or broad
barrel-import issue. Accessibility semantics and large-label wrapping are
encoded in the primitive boundary. Physical visual evidence is `NOT_RUN`
because no production route adopts the primitives in this slice.

## Remaining limitations

- Candidate brand colors still require owner approval.
- These primitives are compiled and contract-tested but are not yet visible in
  production screens.
- Focus-ring presentation on native depends on platform accessibility behavior
  and requires physical validation in Slice 13.
- Dark native theming, reduced-motion runtime selection, exact responsive
  breakpoints, screenshots, large-text, keyboard, and TalkBack proof remain
  later-slice work.
- All recorded A49, hardware, Play, signing, public-policy, and pilot blockers
  remain unchanged.

## Commit

```text
PENDING — record after final validation
```

## Next smallest safe slice

MOB-13 Slice 08 — adopt the primitives in the cashier shell, home/navigation,
and readiness presentation only. Preserve current route gates, device setup,
organization switching, transaction-custody sign-out guard, and diagnostic
authorization boundary. Do not begin catalogue/cart/tender refactoring.
