# MOB-13 Slice 06 — UI contract and screen inventory

Status: **AUDIT COMPLETE — IMPLEMENTATION NOT STARTED**

## Phase and ticket

```text
Mobile Phase 13
MOB-13 Slice 06
Web/mobile UI contract and cashier screen inventory
```

## Starting repository state

```text
Branch: TINDIO-PREPRODUCTION
Starting commit: 2632f572fd28222bab48469e93809e0ae852114c
Tracking branch: origin/TINDIO-PREPRODUCTION
Tracking relationship at audit: local branch ahead by 1 commit
Remote tracking commit: f9d4594c4e175bdf7a8fb8060ca77bc70be98752
Working tree before Slice 06: clean
```

The one local commit ahead of the tracking branch is
`2632f57 docs(mobile): define web mobile UI convergence plan`. It contains the
locked UI source of truth and implementation handoff plus their source-of-truth
addenda. This audit treats that commit as approved starting context and does not
rewrite it.

No fetch was performed because updating remote state is an external network
operation and was not necessary to preserve or inspect the current approved
local branch. The remote relationship above is the locally recorded tracking
state, not a claim that the hosted remote was refreshed during this slice.

## Sources read and availability

The audit read the repository copies of:

- `AGENTS.md` and `apps/mobile/AGENTS.md`;
- `docs/TINDIO_MOBILE_NEON_SOURCE_OF_TRUTH.md`;
- `docs/recovery/TINDIO_NEON_RECOVERY_SOURCE_OF_TRUTH.md`;
- `docs/mobile-program/TINDIO_POS_WEB_MOBILE_UI_SOURCE_OF_TRUTH.md`;
- `docs/mobile-program/PHASE_13_NATIVE_CASHIER_PARITY.md`;
- MOB-13 Slice 01 through Slice 05 reports;
- `docs/mobile-program/MOB_10_DEFERRED_EVIDENCE_REGISTER.md`;
- Phase 23 Android hardening and Phase 24 Google Play testing/release reports;
- the current web POS, native routes, native cashier components, shared POS
  contracts, relevant package scripts, and design-variable definitions.

The handoff also names four supplied documents which are not present in the
repository under those names: `TINDIO-MOBILE-PRODUCTION-PLAN.md`,
`TINDIO-REPOSITORY-AUDIT.md`, `SOL-IMPLEMENTATION-HANDOFF.md`, and
`TINDIO-ACCEPTANCE-MATRIX.md`. Their absence is an evidence availability gap;
this report does not infer or recreate their contents. Existing recorded
acceptance statuses are preserved.

The root Next.js rule was observed. Slice 06 changes no Next.js application
code, so no version-specific Next.js API decision was required. The mobile
package remains Expo `~57.0.27`, React Native `0.86.3`, and Expo Router
`~57.0.25`. Slice 06 changes no Expo or React Native API.

## Observed defect

The web POS is a componentized responsive workspace. The native app has broad
functional cashier coverage, but most routes are raw React Native primitives
with route-local styling. The main checkout is a 1,469-line route that combines
local-first catalogue loading, cart behavior, customer and ticket behavior,
online/offline checkout custody, and one long presentation surface.

Cashier-visible checkout copy currently includes `LOCAL-FIRST POS`, `Catalog
source: SQLite`, internal store/register identifiers, `LOCAL PREVIEW ONLY`,
inventory implementation detail, and the current checkout operation key. This
is useful diagnostic evidence but is not the intended production cashier
hierarchy. Phone and tablet presentations are not deliberately separated.

The defect is presentation architecture and language, not missing transaction
behavior. Functional Phase 13 and MOB-13 Slices 01-05 retain their recorded
results.

## Architecture decision

Use the existing web POS as the workflow and hierarchy reference while keeping
separate DOM and React Native renderers. Introduce one data-only semantic token
contract, adapt it independently for CSS and React Native, and then add small
native primitives. Preserve screen controllers, hooks, services, storage,
operation identities, test IDs, and permission gates.

The preferred boundary is:

```text
existing hooks, services, stores, and actions
                    |
                    v
existing route controller / bounded local view model
                    |
                    v
small native presentation components
```

Slice 07 must establish tokens and foundational controls only. It must not
extract or restyle the checkout flow, change route behavior, or add a UI
library.

## Navigation map

```text
unauthenticated
└── sign-in
    └── authenticated shell
        ├── cashier home / preparation
        ├── Start selling
        │   ├── catalogue search / category / scan
        │   ├── variable-price editor
        │   ├── modifier editor
        │   ├── cart / customer / ticket context
        │   ├── cash tender
        │   └── local or authoritative receipt result
        ├── Receipts
        │   ├── local receipt detail
        │   └── cloud receipt detail / refund / delivery
        ├── Customers
        ├── Shift and cash drawer
        ├── Open tickets
        ├── Incoming transfers
        ├── Time clock
        ├── Sync and recovery
        └── Account and support
            └── authorized diagnostics
                ├── hardware support
                ├── payment safety
                ├── release diagnostics
                └── A45 certification diagnostics
```

Feature flags and permissions continue to determine which operational routes
exist. Sync/recovery and custody visibility must not be hidden by presentation
changes. Diagnostic direct routes remain guarded in the authenticated layout.

## Web reference inventory

| Web source | Existing presentation/state responsibility | Native convergence target |
| --- | --- | --- |
| `pos-v2-terminal-shell.tsx` | startup loading, domain/bootstrap warning, retry, shell data boundary | preparation/loading/retry states without exposing transport detail |
| `pos-workspace-header.tsx` | register identity, operational navigation, customer action, compact cart action | compact terminal header on phone; persistent header on tablet |
| `pos-terminal.tsx` | shift/configuration gates, catalogue, search, categories, favorites, item editors, cart, tickets, totals, charge entry | native catalogue-first phone flow and catalogue/cart tablet split |
| `payment-screen.tsx` | focused tender, method selection, cash suggestions, tendered/change, submit/result states | focused native cash tender step with one acceptance action |
| `pos-customer-picker.tsx` | customer search/select/create, empty/error/loading, selection | native sheet/full-screen search and online-create boundary |
| `pos-operational-drawer.tsx` | task navigation, current workspace, sign out | width-appropriate native task navigation/support boundary |
| receipt search/history/detail | search, selected receipt, skeleton/error, delivery/refund dialogs | local/cloud receipt list and native detail states |
| incoming transfer inbox | transfer selection and receive workflow | native transfer list, line discrepancy, online restriction |
| settings workspace | printer/scanner/appearance/device information | cashier settings separated from authorized diagnostics |
| `src/components/ui/*` | button, input, badge, card, dialog, label, separator, tooltip vocabulary | semantic equivalence through native primitives, not JSX reuse |

The web catalogue already distinguishes compact and wide behavior, provides a
compact cart summary, a cart review dialog, explicit empty-catalogue handling,
manual-price and modifier dialogs, and bounded item pagination. These are the
reference behaviors; CSS breakpoints and DOM mechanics are not portable
requirements.

## Native screen and state inventory

| Native route/component | Current states and actions | Required convergence decision |
| --- | --- | --- |
| `sign-in.tsx` | offline readiness/restriction, email/password, pending, sanitized error, policy links | KEEP behavior; REFACTOR into branded auth surface using primitives; add preparation guidance |
| `(app)/index.tsx` | loading, context failure/retry, preparation/device setup, readiness, expiring/restricted warnings, task cards, organization switch, guarded sign-out | KEEP + HARDEN; become shared cashier shell reference |
| `(app)/pos.tsx` | loading/catalogue, search, barcode/SKU, camera, categories, products, cart, inventory estimate, discounts/tax/dining, customer, tickets, unsupported-offline restriction, persisted online intent, tender, offline/online acceptance, result message | REFACTOR in Slices 09-11 without changing handlers; phone cart step and tablet split are NEW |
| `cashier-editors.tsx` | variable price; modifier loading/selection/validation; cancel/confirm | KEEP behavior; REFACTOR to native modal/sheet foundation |
| `cashier-cart-line.tsx` | quantity input, note, price/modifier edit, remove, line totals | KEEP behavior; REFACTOR presentation; EXTEND with accessible steppers |
| `customers.tsx` | enrollment restriction, online/cached search, populated/empty result, create online, message/error | KEEP behavior; REFACTOR hierarchy and restriction/empty states |
| `receipts.tsx` | unavailable/denied, local plus cloud search, initial/populated/empty, detail navigation | KEEP + HARDEN; distinguish saved locally, pending/review, and official |
| `local-receipt/[eventId].tsx` | loading/not found/detail, immutable snapshot, copy preparation | KEEP custody; REFACTOR receipt status and next actions |
| `receipt/[receiptId].tsx` | loading/error/detail, item selection, refund quantity/reason, delivery recipient, mutation results | KEEP online contracts; REFACTOR into explicit receipt actions |
| `shift.tsx` | no enrollment, open form, active shift, close/finalization restriction, counted cash, pay-in/pay-out, pending/message | KEEP custody/finalization; REFACTOR action hierarchy and restrictions |
| `tickets.tsx` | feature/permission/enrollment gate, loading/list/selection, cancel, split, merge, move, mutation result | KEEP online-only operations; REFACTOR selection and destructive confirmation |
| `transfers.tsx` | permission/enrollment gate, loading/list/selection, received quantity/discrepancy, submit/result | KEEP online-only contract; REFACTOR line editor and discrepancy language |
| `time-clock.tsx` | permission/enrollment gate, employee load, PIN, clock-in/out, pending/result | KEEP identity/operation ID; REFACTOR to one focused current-state action |
| `sync-status.tsx` | database/cache health, readiness grant, outbox summary, recovery items, reauthentication, reviewed retry, sequence/checkpoint, reconciliation, Store Hub, performance and A30 test controls | KEEP recovery/custody paths; REPLACE cashier overview; MOVE engineering/test controls to authorized diagnostics |
| `settings.tsx` | account/session, terminal details, Store Hub settings/test/clear, custody-aware actions, policy links | KEEP custody and support links; SPLIT cashier settings from manager/support diagnostics |
| `hardware.tsx` | supported/deferred hardware scope and adapter status | KEEP as authorized diagnostic; REFACTOR with diagnostic rows |
| `offline-payments.tsx` | cash support and electronic/card restrictions | KEEP as authorized policy diagnostic; cashier tender shows only actionable boundary |
| `production-readiness.tsx` | version/upgrade proof arm/verify and release diagnostics | KEEP guarded; REFACTOR only after cashier screens |
| `a45-certification.tsx` | exit history and destructive synthetic crash/ANR controls | KEEP guarded certification-only; never expose as routine cashier task |

### Required state vocabulary

Every applicable converged screen must deliberately cover:

- initial loading and refresh;
- populated and empty content;
- field validation and action failure;
- network unavailable and online-only restriction;
- permission denied and incomplete terminal preparation;
- operation pending without duplicate activation;
- durable local acceptance;
- authoritative/official completion;
- unknown result/retry using the original identity;
- recovering and sync review;
- long labels, large values, fractional quantities, keyboard-visible layout,
  and large display/font scaling.

Cashier readiness labels remain distinct: `READY OFFLINE`, `EXPIRING SOON`,
`EXPIRED / RECONNECT REQUIRED`, `PREPARATION REQUIRED`, `RECOVERING`, and
`SYNC REVIEW`. Presentation must not merge these states.

## Detailed POS presentation inventory

The existing POS controller calculates or owns all of the following and they
must be presented without being reimplemented:

- local catalogue, categories, payment methods, tax/discount/dining reference
  data and initial customer results;
- connection mode, cached offline authorization, active shift and
  store/register match;
- search query, category selection, barcode/SKU lookup and camera scanner;
- duplicate HID/camera scan protection;
- variable-price and modifier configuration;
- cart identity, quantities, notes, totals, tax/discount and stock estimates;
- customer online/cached search, create, select, and clear;
- open-ticket load/save/resume;
- unsupported offline-cart detection;
- cash tender, change, cash-method availability and permission gates;
- offline final authorization validation and durable commit-before-success;
- persisted online checkout intent, exact-payload retry, unknown/rejected/
  acknowledged results and offline-fallback block;
- outbox synchronization after accepted work.

Current top-level full-screen alternatives are camera scan, variable-price
editor, and modifier picker. Everything else is rendered sequentially inside
one keyboard-aware scroll surface. The future phone cart sheet/step and tablet
split must consume the same controller state and handlers.

## Protected code and test contract

### Protected handlers in `pos.tsx`

- `load`, `markCartChanged`, `commitConfiguredLine`,
  `continueWithModifiers`, `startConfigure`, and `add`;
- `findLookupValue`, `find`, `acceptCameraBarcode`, and the scan guards;
- `setLineQuantity`, `setLineNote`, and `removeLine`;
- `searchCustomers`, `createCustomer`, `loadTickets`,
  `loadTicketIntoCart`, and `saveCurrentTicket`;
- `clearSaleState`, `saveOfflineCashSale`, and
  `completeOnlineCashSale`.

### Protected dependencies and stores

- business/session/device providers and Expo Router permission guards;
- SQLite catalogue, customer, receipt, inventory-estimate, authorization,
  checkout-intent, outbox, recovery, cursor, and device-sequence stores;
- local cart totals, modifier lookup, stock intelligence and offline-cart
  eligibility;
- POS v2 bootstrap, live, customer, ticket, receipt, checkout, shift,
  transfer, and time-clock API paths;
- `apps/mobile/src/features/outbox/*`, synchronization/reconciliation, receipt
  scoping, local tenant isolation, root crash/exit reconciliation, and Phase
  22/26 telemetry.

### Stable test IDs

The following IDs are evidence dependencies and must remain stable, or every
dependent test/evidence path must be updated in the same implementation slice:

```text
sign-in-scroll
pos-scroll
variable-price-scroll
modifier-picker-scroll
offline-cart-restriction
checkout-panel
cash-tender-input
offline-readiness
save-offline-cash-sale
complete-online-cash-checkout
receipts-scroll
search-receipts
sync-status-scroll
recheck-backend
sync-durable-outbox
refresh-server-checkpoint
create-a30-100
create-a30-1000
```

Accessibility labels for sign-in, barcode/cash inputs, cart-line edit/remove,
checkout acceptance, receipt search, and checkpoint recovery are part of the
same contract. Existing IDs do not constitute complete accessibility coverage.

## Design-token inventory

The web currently defines light and dark semantic CSS variables for background,
foreground, card, popover, primary, secondary, muted, accent, destructive,
border, input, ring, charts, sidebar surfaces, and radius derivations. The base
light theme is warm-neutral with a teal primary. Tailwind utilities currently
provide spacing, typography, shadow, focus, responsive, and motion values
without a framework-neutral TINDIO contract.

The mobile global CSS contains only font-family variables and is not a native
theme. Native routes mainly use inline numeric styles and platform defaults.

Candidate, not approved, brand inputs remain:

```text
primary teal: #007A67
dark ink:     #14231F
warm cream:   #F4EFE5
```

### Proposed framework-neutral token contract

Create a TypeScript data module at
`src/contracts/ui/tindio-design-tokens.ts`. The repository already permits the
mobile application to import framework-neutral root contracts. The module must
contain serializable primitives only and import no React, React Native, DOM,
CSS, Tailwind, Expo, or Node runtime module.

Required groups:

```text
color.brand
color.surface
color.content
color.border
color.status
typography.role
space
radius
elevation
icon.size
target.minimum
motion.duration
```

Status tokens must include success, warning, danger, information, recovering,
and review. Numeric and receipt values need a deliberate numeric typography
role. Motion must include a reduced-motion-safe duration. Token names describe
semantic use, not a particular screen or CSS utility.

The web adapter remains CSS variables in `src/app/globals.css`. The native
adapter maps the same contract to React Native-compatible theme objects under
`apps/mobile/src/ui/`. Neither renderer imports the other.

## Gap matrix

| Classification | Decision |
| --- | --- |
| KEEP | Expo Router, native application, Next.js web POS, web visual reference, shared POS contracts, business providers, backend services, SQLite/local-first reads, outbox/recovery, receipt snapshots, authorization and security gates |
| KEEP + HARDEN | branded cashier home, sign-in, readiness vocabulary, route permission guards, accessible labels, local/cloud receipt distinction, cashier-safe recovery access |
| EXTEND | framework-neutral semantic tokens, mobile theme adapter, loading/empty/error/restriction primitives, deliberate responsive state and accessibility coverage |
| REFACTOR | native route-local raw controls; POS presentation around its existing controller; supporting workflows into small screen sections; diagnostic hierarchy |
| REPLACE | engineering-first cashier wording, unstructured one-scroll checkout presentation, UUID/event/checkpoint-first content on ordinary cashier surfaces |
| REMOVE | no business capability; remove engineering copy only from cashier prominence after equivalent authorized diagnostics remain available |
| NEW | phone cart summary/sheet or step, tablet catalogue/cart split, native primitive kit, receipt/readiness/status presentation, screenshot fixtures and accessibility/responsive evidence in later slices |

## Exact expected Slice 07 files

Slice 07 is limited to the following expected implementation boundary. Any
additional file requires a recorded reason in that slice report.

```text
NEW     src/contracts/ui/tindio-design-tokens.ts
MODIFY  src/app/globals.css
NEW     apps/mobile/src/ui/theme.ts
NEW     apps/mobile/src/ui/tindio-screen.tsx
NEW     apps/mobile/src/ui/tindio-button.tsx
NEW     apps/mobile/src/ui/tindio-input.tsx
NEW     apps/mobile/src/ui/tindio-status-badge.tsx
NEW     apps/mobile/src/ui/tindio-card.tsx
NEW     apps/mobile/src/ui/tindio-feedback.tsx
NEW     scripts/mobile-mob-13-ui-contract.test.mjs
MODIFY  package.json
NEW     docs/mobile-program/MOB_13_SLICE_07_SHARED_TOKENS_NATIVE_PRIMITIVES.md
```

`tindio-feedback.tsx` is the bounded home for loading, empty, error,
restriction, and recovery banners; it must not own business-state transitions.
The primitives must expose accessibility roles/labels, disabled/busy states,
minimum 48 dp targets, large-text-safe wrapping, and testable variants. They
must not add a dependency or modify `pos.tsx` in Slice 07.

Component examples/tests should cover primary, secondary, ghost and
destructive buttons; text/search/numeric input intent; positive, warning,
danger, recovering and review states; cards; and screen safe-area/scroll
behavior. Snapshot-only assertions are insufficient: source/behavior checks
must verify semantics and minimum targets.

## Responsive and evidence contract

Later implementation must validate 360×800 and 390×844 phone classes, 600 px
compact tablet, and 800 px-or-wider tablet/POS layouts in portrait and supported
landscape, with keyboard closed/open and default/large scaling. Breakpoints must
come from observed native layout behavior, not copied CSS values.

Existing physical evidence under `evidence/mob-13-slice-04/` proves the
candidate icon/splash and one preparation/recovery state on a Xiaomi 21121210G.
It does not inventory the signed-in checkout or tablet presentation. No new
runtime screenshot was captured in this documentation slice because a
reproducible authorized synthetic web/mobile state and tablet runtime were not
established. Therefore:

```text
web desktop reference:       NOT_RUN in Slice 06
web compact reference:       NOT_RUN in Slice 06
native phone checkout:       NOT_RUN in Slice 06
native tablet checkout:      NOT_RUN in Slice 06
existing recovery screenshot: retained as historical development evidence
A49 physical certification:  BLOCKED
```

This explicit gap must be closed with real running deterministic states during
the relevant implementation/accessibility slices; mockups cannot be used as
certification evidence.

## Database, SQLite, API, and security impact

```text
Neon/PostgreSQL migration: NONE
SQLite migration/reset: NONE
POS v2 API change: NONE
Supabase Auth change: NONE
Tenant/store enforcement change: NONE
Transaction/idempotency identity change: NONE
Outbox/recovery deletion: NONE
New dependency: NONE
Production screen behavior change: NONE
```

This file is documentation only. It neither reads nor mutates merchant data,
credentials, transaction custody, device state, EAS/Play configuration, or
external infrastructure.

## Validation plan and result

For this audit-only slice, required validation is limited to source inspection,
documentation consistency, the existing source-of-truth contract, and diff
hygiene. Typecheck, lint, Android export, behavior suites, and physical-device
tests provide no additional coverage for a Markdown-only change and are
recorded as `NOT_RUN`, not `PASS`.

```text
pnpm test:mobile-source-of-truth: PASS — 4 tests, 0 failures
git diff --check:                 PASS
mobile/root typecheck:            NOT_RUN — documentation-only slice
mobile/root lint:                 NOT_RUN — documentation-only slice
mobile:export:android:            NOT_RUN — no application change
physical Android checks:          NOT_RUN — no runtime change
```

## Remaining limitations

- The four externally supplied documents named above were unavailable in the
  repository during the audit.
- Reference screenshots for deterministic web desktop/compact and native
  phone/tablet checkout states remain open.
- Candidate brand colors remain unapproved.
- Exact native responsive breakpoint selection requires runtime observation.
- A49 and all previously deferred hardware, Play, signing, public-policy, and
  merchant-pilot evidence retain their recorded statuses.
- TINDIO POS UI convergence is not implemented or production certified.

## Commit

```text
PENDING — record the focused Slice 06 commit after validation
```

## Next smallest safe slice

MOB-13 Slice 07 — add the framework-neutral semantic token contract, the web
mapping, and the foundational native primitives listed above. Do not change
checkout behavior or begin the POS visual refactor in that slice.
