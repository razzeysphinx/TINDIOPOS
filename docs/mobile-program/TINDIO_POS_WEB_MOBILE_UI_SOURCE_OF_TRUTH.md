# TINDIO POS Web and Mobile UI Convergence

## UI source of truth

Status: **LOCKED FOR IMPLEMENTATION - NOT YET IMPLEMENTED OR CERTIFIED**

Created: **2026-10-16**

Branch: **TINDIO-PREPRODUCTION**

Baseline commit: **f9d4594c4e175bdf7a8fb8060ca77bc70be98752**

This document is the authoritative product and implementation contract for
bringing the TINDIO native Android cashier experience into visual and workflow
convergence with the TINDIO web POS.

In this document, **convergence** means one recognizable TINDIO product with a
shared visual language, information hierarchy, terminology, and cashier
workflow. It does not mean embedding the website in the Android application or
forcing web and native clients to share rendering code.

This document does not claim that the work described below is already
implemented, physically validated, release-ready, or production-certified.

---

## 1. Authority and precedence

This is the base source of truth for:

- cashier-facing visual design;
- web/mobile workflow alignment;
- mobile navigation and information architecture;
- responsive phone and tablet behavior;
- native UI component requirements;
- cashier-facing wording and state presentation;
- visual, accessibility, and physical-device acceptance for the UI campaign.

It does not replace or weaken the following authorities:

1. `docs/TINDIO_MOBILE_NEON_SOURCE_OF_TRUTH.md`
2. `docs/recovery/TINDIO_NEON_RECOVERY_SOURCE_OF_TRUTH.md`
3. the supplied `TINDIO-MOBILE-PRODUCTION-PLAN.md`
4. the supplied `TINDIO-ACCEPTANCE-MATRIX.md`
5. existing phase evidence under `docs/mobile-program/`
6. repository and application `AGENTS.md` instructions

If a visual requirement conflicts with transaction custody, tenant isolation,
authorization, accessibility, recovery, or release safety, the safety rule
wins and the visual design must adapt.

The canonical Mobile Phases 00-26 remain unchanged and must not be renumbered.
This campaign reopens Phase 13 presentation work as additional MOB-13 slices;
it does not invent a replacement phase structure.

---

## 2. Product decision

The web POS and native Android POS must feel like the same TINDIO product.

They must share:

- brand colors and semantic state colors;
- typography hierarchy;
- spacing, radius, elevation, and icon rules;
- button hierarchy and input behavior;
- product, cart, tender, receipt, and recovery terminology;
- cashier task ordering;
- status meanings;
- empty, loading, failure, and restricted-state language;
- domain contracts and display formatting where framework-neutral sharing is
  safe.

They must retain separate platform renderers:

- Web: Next.js, React DOM, CSS/Tailwind utilities, and current web components.
- Mobile: Expo, React Native, Expo Router, native platform controls, SQLite,
  and native device integrations.

The mobile application must not become a WebView. The web application must not
be replaced by React Native Web as part of this campaign. The existing Expo
application must be preserved.

---

## 3. Current baseline and observed gap

At the baseline commit, the repository contains strong functional cashier
coverage and a mature web POS presentation, but it does not contain complete
web/mobile visual parity.

### Web baseline

The primary responsive web cashier experience is implemented in:

- `src/features/pos/pos-terminal.tsx`
- `src/features/pos/pos-v2-terminal-shell.tsx`
- `src/features/pos/pos-workspace-header.tsx`
- `src/features/checkout/payment-screen.tsx`
- `src/features/customers/pos-customer-picker.tsx`
- `src/features/pos/pos-operational-drawer.tsx`
- `src/app/globals.css`
- reusable controls under `src/components/ui/`

It already presents a branded header, responsive catalogue, product cards,
category controls, desktop cart pane, compact/mobile cart controls, payment
surfaces, dialogs, alerts, empty states, and structured typography.

### Mobile baseline

The native application already contains routes for:

- sign-in and preparation;
- cashier home;
- POS checkout;
- customers;
- receipts and local receipt detail;
- shifts;
- tickets;
- transfers;
- time clock;
- synchronization status and recovery;
- settings and authorized support diagnostics.

The main mobile checkout is currently concentrated in
`apps/mobile/app/(app)/pos.tsx`. It exposes substantial cashier functionality,
but much of its presentation is raw `Text`, `TextInput`, `Pressable`, inline
styles, and one long scrolling surface. It also exposes engineering language
such as SQLite source information, internal identifiers, and local-preview
details directly in the cashier workflow.

### Correct status interpretation

`PHASE_13_NATIVE_CASHIER_PARITY.md` records functional cashier parity. MOB-13
Slices 01-05 hardened cashier navigation, support boundaries, branding, and
release-input controls. Those records remain valid for what they tested.

They do **not** prove full visual parity, final cashier usability, complete
phone/tablet responsiveness, or production UI certification. The physical
device view of the main checkout exposed this additional presentation gap.

Therefore:

```text
PHASE 13 FUNCTIONAL IMPLEMENTATION: RETAINED
MOB-13 SLICES 01-05: RETAINED
MOB-13 UI CONVERGENCE: REOPENED FOR SLICES 06-14
PRODUCTION UI CERTIFICATION: OPEN
```

---

## 4. Non-negotiable architecture boundaries

Every UI slice must preserve:

- the existing Expo/React Native application;
- the existing Next.js web and backend application;
- POS v2 APIs and current compatible backend paths;
- Supabase Auth;
- provider-neutral business identity;
- Neon-backed PostgreSQL authority;
- SQLite local-first reads and durable state;
- the existing checkout and inventory engines;
- stable operation IDs and idempotency keys;
- stable device sequences;
- immutable receipt snapshots;
- outbox events and sync cursors;
- checkout intents and recovery records;
- MOB-08 custody and finalization guards;
- tenant, employee, store, register, device, and shift enforcement;
- offline cash boundaries;
- the prohibition on ordinary offline electronic/card acceptance until a real
  compliant provider and protocol are selected.

The backend remains authoritative for official sales, payments, receipts,
shifts, permissions, and inventory. Mobile may calculate display estimates,
but the UI must never label estimates as authoritative stock.

No UI work may:

- create a second checkout or inventory engine;
- replace an identity when retrying the same operation;
- reset SQLite to repair presentation state;
- clear app data or require reinstall as recovery;
- delete unresolved financial custody;
- hide unresolved work merely to make a screen look clean;
- weaken online-only workflow boundaries;
- fabricate production evidence or Play listing screenshots.

---

## 5. Shared versus platform-specific implementation

| Share across web and mobile | Keep platform-specific |
| --- | --- |
| Semantic design tokens | DOM and CSS/Tailwind implementation |
| Typography hierarchy | React Native layout and styles |
| Spacing and radius scale | Native safe-area handling |
| Icon meaning and sizing rules | Native keyboard behavior |
| Button and alert hierarchy | Camera/scanner integration |
| Cashier labels and status meanings | Printer and device integrations |
| Money, quantity, and date formatting contracts | Web pointer/keyboard interactions |
| Domain display models where safe | Android lifecycle handling |
| Accessibility intent | SQLite/offline runtime wiring |
| Screen and workflow specification | Platform navigation implementation |

Do not attempt to share JSX between DOM and React Native merely for cosmetic
reuse. Prefer a small framework-neutral token and presentation-contract layer,
then implement web and native controls independently.

Existing shared domain contracts may be reused when they are already correct.
Presentation work must not move backend business rules into a shared UI
package.

---

## 6. Target cashier experience

### 6.1 Global experience principles

The completed application must be:

- immediately recognizable as TINDIO POS;
- optimized for fast cashier repetition;
- usable without understanding synchronization internals;
- explicit when a business action is restricted;
- honest about offline, recovering, or review states;
- safe during interrupted checkout and reconciliation;
- readable on a low-end phone and an agreed tablet/POS form factor;
- operable with large text, TalkBack, and an on-screen keyboard;
- consistent with the web POS without blindly copying a desktop layout.

### 6.2 Phone layout

The phone experience must use:

- a compact branded register header;
- a clear readiness/connection indicator;
- catalogue-first browsing;
- a sticky cart summary and primary action;
- a cart sheet or dedicated cart step;
- full-screen or sheet-based editors for modifiers and variable price;
- a focused tender flow;
- safe-area-aware controls;
- no horizontally clipped critical action.

### 6.3 Tablet layout

The tablet experience should use:

- a persistent register header;
- a product catalogue and cart split view where space permits;
- persistent totals and charge action;
- larger product targets without excessive empty space;
- an operational drawer or side navigation appropriate to the width.

The exact breakpoint must be selected from observed React Native layout
behavior, not copied mechanically from CSS breakpoints. Tests must cover the
required widths in Section 15.

### 6.4 Engineering information boundary

Cashier surfaces must not lead with:

- SQLite implementation details;
- organization/store/register UUIDs;
- event IDs or idempotency keys;
- cursor or checkpoint internals;
- `LOCAL PREVIEW ONLY` engineering copy;
- raw API or database terminology.

These details may remain available in an authorized support/diagnostics
surface because they are important for recovery and evidence. Moving them must
not make unresolved transactions inaccessible.

---

## 7. Required readiness and recovery presentation

The UI must preserve the established authorization and synchronization state
machine. Styling must not merge materially different states.

Required cashier-facing states include:

| State | Cashier meaning | Required presentation |
| --- | --- | --- |
| READY OFFLINE | Authorized supported offline cash work is available | Positive but not misleading status chip/banner |
| EXPIRING SOON | Authorization will expire unless connectivity is restored | Proactive non-technical warning and action guidance |
| EXPIRED / RECONNECT REQUIRED | New restricted offline work is blocked | Clear restriction; existing receipts/custody remain available |
| PREPARATION REQUIRED | Device context is incomplete or not prepared | Guided connection/preparation action |
| RECOVERING | Connectivity returned and reconciliation is active | Progress explanation; do not claim online completion early |
| SYNC REVIEW | One or more entries need review | Prominent path to review without deleting or hiding custody |

Local timers may warn or restrict; they must never renew authorization.
Checkout acceptance must retain its final authorization validation to prevent a
timer race.

---

## 8. Screen convergence matrix

| Domain | Web reference | Mobile route/reference | Required convergence |
| --- | --- | --- | --- |
| Authentication | Current workspace/POS authentication surfaces | `apps/mobile/app/sign-in.tsx` | Same brand, plain-language errors, preparation guidance |
| Cashier home | POS header and operational entry points | `apps/mobile/app/(app)/index.tsx` | Branded terminal identity, readiness, task cards, safe support boundary |
| Catalogue | `pos-terminal.tsx` catalogue region | `apps/mobile/app/(app)/pos.tsx` | Search, category filters, product cards/list, price/unit/variant signals |
| Scanner | Web barcode interaction | POS route plus native camera guard | One clear scan action, manual fallback, duplicate suppression |
| Cart | Web desktop cart and compact cart bar | POS route and cashier cart-line components | Phone sheet/tablet pane, quantities, line notes, totals, clear hierarchy |
| Modifiers/price | Web item editors | `cashier-editors.tsx` | Native modal/sheet with equivalent choices and validation |
| Customer | `pos-customer-picker.tsx` | `customers.tsx` and POS customer section | Search/select/create with online/offline limitations explained |
| Tickets | Web ticket workspace dialogs | `tickets.tsx` and POS ticket section | Load/save/update actions with online-only boundary visible |
| Tender | `payment-screen.tsx` | POS tender controls | Focused cash tender, received/change, safe disabled states |
| Receipt result | Web checkout result/receipt | local receipt and cloud receipt routes | Durable acceptance wording, provisional/official distinction, next action |
| Receipt history | Web receipt search/history | `receipts.tsx` | Store/tenant-safe search, status, offline visibility and detail |
| Shift | Web shift surfaces | `shift.tsx` | Open/close/cash movement hierarchy and custody restrictions |
| Transfers | POS incoming transfer UI | `transfers.tsx` | Equivalent line/discrepancy language and online boundary |
| Time clock | Current web time-clock workflows | `time-clock.tsx` | Simple clock action and current state |
| Sync/recovery | Web offline queue/control surfaces | `sync-status.tsx` | Plain-language overview plus authorized detail and recovery actions |
| Settings/support | POS settings/operational drawer | `settings.tsx`, guarded diagnostic routes | Cashier settings separated from manager/support diagnostics |

Each slice must refine this matrix with exact states and screenshots before
changing the corresponding screen.

---

## 9. Shared design contract

The implementation must create one framework-neutral semantic design contract.
Its final repository location is selected during Slice 07 after dependency and
build-boundary inspection.

Required token groups:

- brand: primary teal, dark ink, warm cream, supporting neutrals;
- surfaces: app background, card, elevated surface, input, overlay;
- content: primary text, secondary text, disabled text, inverse text;
- borders and focus indicators;
- status: success, warning, danger, information, recovering, review;
- typography roles: display, title, section, body, label, caption, numeric;
- spacing scale;
- corner-radius scale;
- elevation/shadow roles;
- icon sizes;
- minimum interactive target;
- motion durations and reduced-motion behavior where applicable.

Candidate brand colors already recorded by MOB-13 are:

```text
Primary teal: #007A67
Dark ink: #14231F
Warm cream: #F4EFE5
```

They remain candidate inputs until the authorized product owner approves them.
Implementation must not silently convert candidate branding into final
production approval.

The token layer must not import browser-only or native-only modules. Web CSS
variables and React Native styles may adapt the tokens independently.

---

## 10. Native component kit

The native presentation layer should be decomposed into small, testable
components instead of extending the current checkout monolith.

Expected component families:

- screen/safe-area container;
- terminal header;
- readiness and connection badge;
- primary, secondary, ghost, and destructive buttons;
- text, numeric, search, and barcode inputs;
- product card and product list row;
- category chip/filter;
- cart summary bar;
- cart panel/sheet;
- cart line and quantity stepper;
- money summary;
- alert, restriction, and recovery banner;
- modal/sheet/dialog foundation;
- empty, loading, and error state;
- receipt status and receipt summary;
- task/navigation card;
- authorized diagnostic row.

Use React Native primitives and SDK-compatible Expo modules. Do not add a UI
library until the slice audit proves that it is necessary, compatible with Expo
SDK 57, accessible, and smaller/safer than implementing the required controls.

Before changing Expo, EAS, or React Native APIs, follow
`apps/mobile/AGENTS.md`: confirm the installed Expo major and read the matching
Expo documentation.

---

## 11. Presentation architecture

The preferred refactoring boundary is:

```text
existing hooks/services/state/actions
                 |
                 v
framework-local screen controller/view model
                 |
                 v
small native presentation components
```

Do not rewrite proven business behavior merely to style it.

For the POS screen specifically:

1. Preserve current catalog, cart, checkout, outbox, readiness, and recovery
   calls.
2. Identify presentation state and event handlers already calculated by the
   route.
3. Extract small render components or a framework-local view model in bounded
   steps.
4. Keep stable test IDs for safety-critical actions, or update every dependent
   test in the same slice.
5. Avoid a full-file rewrite of `pos.tsx`.

The web POS remains the primary visual/workflow reference, not a source to copy
blindly. Mobile interaction patterns must remain native and responsive.

---

## 12. Cashier language rules

Cashier wording must:

- describe the task or outcome, not the implementation;
- distinguish saved locally, pending sync, official, rejected, and review;
- avoid claiming success before durable local or authoritative commit;
- explain what the cashier can do next;
- avoid blaming the cashier for network or synchronization failures;
- state when connectivity is required;
- preserve original accepted-cash history when settlement is rejected;
- avoid exposing secrets, tokens, raw stack traces, or sensitive IDs.

Examples:

| Avoid | Prefer |
| --- | --- |
| Catalog source: SQLite | Products available offline |
| Backend V1 connected | Connected to TINDIO |
| API request failed | We could not reach TINDIO. Your saved work remains on this device. |
| LOCAL PREVIEW ONLY | Estimated stock (may change after sync) |
| Event sync conflict | This transaction needs review |

Technical diagnostic detail may be offered through an authorized expandable
support section.

---

## 13. Phase and slice plan

The canonical phases are not renumbered. The campaign is executed as these
additional MOB-13 slices:

### MOB-13 Slice 06 - UI contract and screen inventory

Deliver:

- current web/mobile screen and state inventory;
- reference screenshots at agreed phone, tablet, and desktop widths;
- final convergence matrix;
- navigation map;
- initial token inventory from web CSS and components;
- explicit KEEP / KEEP + HARDEN / EXTEND / REFACTOR / REPLACE / REMOVE / NEW
  matrix;
- list of protected handlers, hooks, storage, and test IDs;
- exact expected files for Slice 07.

No production screen implementation should change in Slice 06 unless the
audit reveals a small documentation/test harness defect that must be corrected
to make the contract reproducible.

### MOB-13 Slice 07 - shared tokens and native primitives

Deliver:

- framework-neutral semantic tokens;
- web token adapter or verified mapping to existing CSS variables;
- mobile theme adapter;
- foundational native controls;
- component tests/examples;
- no checkout behavior change.

### MOB-13 Slice 08 - cashier shell and navigation

Deliver:

- branded safe-area shell;
- terminal/store/employee hierarchy;
- readiness and connection presentation;
- cashier task navigation;
- authorized diagnostics boundary;
- phone and tablet shell behavior.

### MOB-13 Slice 09 - catalogue and product selection

Deliver:

- search and barcode/SKU controls;
- camera entry point and manual fallback;
- category/favorite filtering where supported;
- product cards/list rows;
- product/variant/price/unit/modifier/variable-price signals;
- loading, empty, error, and large-catalog presentation.

Keep catalog queries local-first and preserve MOB-05 cache correctness.

### MOB-13 Slice 10 - cart and inventory presentation

Deliver:

- phone cart summary and cart sheet/dedicated view;
- tablet cart pane;
- quantity, notes, modifiers, variable price, customer, dining option, and
  supported discount presentation;
- totals hierarchy;
- estimated-stock warnings and unsupported-offline-cart restrictions.

Keep all calculations and eligibility rules on their existing paths.

### MOB-13 Slice 11 - tender, checkout, and receipt result

Deliver:

- focused tender workflow;
- received/change presentation;
- one clear primary acceptance action;
- prevention of accidental duplicate activation;
- durable local acceptance result;
- online result/retry presentation;
- provisional versus official receipt language;
- next-sale and receipt-detail actions.

This is a high-risk slice. It must rerun transaction identity, process-death,
authorization-expiry, and outbox behavioral suites.

### MOB-13 Slice 12 - supporting cashier workflows

Deliver converged screens for:

- customers;
- open tickets;
- receipt search/detail;
- shifts and cash movements;
- transfers;
- time clock;
- sync/recovery review;
- settings and support diagnostics.

Online-only boundaries and permission gates must remain explicit.

### MOB-13 Slice 13 - responsive and accessibility hardening

Deliver:

- compact-phone, standard-phone, compact-tablet, and tablet layouts;
- portrait/landscape behavior where supported;
- keyboard-visible layouts;
- large text/display scaling;
- TalkBack navigation and announcements;
- focus order, labels, roles, contrast, and touch targets;
- screenshot/golden baselines for deterministic states;
- low-end-device performance measurements.

This slice supports A49 but cannot mark A49 PASS without the required physical
device classes and runtime evidence.

### MOB-13 Slice 14 - physical Android UI certification and handoff

On physical supported Android hardware, prove:

- sign-in, enrollment, assignment, and preparation;
- READY OFFLINE presentation;
- catalogue search/scan/product selection;
- cart editing and supported modifiers/price behavior;
- synthetic online cash checkout;
- synthetic offline cash acceptance;
- force-stop/cold-restart custody visibility;
- receipt visibility;
- reconnect/recovery/sync review;
- keyboard and large-text usability;
- TalkBack usability;
- phone and tablet responsive behavior where hardware is available.

Capture truthful screenshots and exact build/device metadata. This remains
development/validation evidence unless it is produced from the actual bound
Phase 23/24 release candidate.

---

## 14. Required per-slice workflow

Every slice must follow:

```text
verify branch and HEAD
fetch latest approved branch state when authorized
inspect working tree and preserve unrelated changes
scan current implementation
reproduce the observed UI/workflow defect
write the gap matrix
name protected components
name expected files
state database/SQLite/API/security/custody impact
implement the smallest safe vertical slice
run targeted behavior and visual checks
run affected phase regressions
run mobile and root validation
inspect physical Android behavior when applicable
commit one focused change
record evidence and next slice
```

Required slice report:

```text
Phase and ticket:
Starting commit:
Observed defect:
Architecture decision:
Gap matrix:
Protected components:
Changed files:
Database/SQLite/API compatibility:
Security and transaction-custody impact:
Tests and exact results:
Physical evidence, if applicable:
Remaining limitations:
Commit:
Next smallest safe slice:
```

Source-contract or screenshot tests are supporting evidence. They do not by
themselves certify a usable physical Android UI.

---

## 15. Validation matrix

### Required viewport/layout coverage

At minimum test:

- 360 x 800 Android phone;
- 390 x 844 Android phone;
- 600 px compact tablet class;
- 800 px or wider tablet/POS class;
- portrait and supported landscape states;
- on-screen keyboard closed and open;
- default and large font/display scaling.

If the supported-device policy selects different concrete models or minimum
dimensions, update the evidence matrix without silently lowering coverage.

### Required UI states

For each applicable screen, test:

- initial loading;
- populated content;
- empty content;
- validation error;
- network unavailable;
- authorization restricted;
- operation pending;
- durable local acceptance;
- recovering;
- sync review;
- permission denied;
- long product/customer/employee/store names;
- large monetary values and fractional quantities where supported.

### Required repository checks

Run the relevant targeted suites plus, at minimum before closing each
implementation slice:

```text
pnpm mobile:typecheck
pnpm typecheck
pnpm --dir apps/mobile lint
pnpm lint
pnpm mobile:export:android
git diff --check
```

Also run affected Phase 06, 08, 09, 10, 13, 14, 16, 17, 18, 21, 22, and 23
checks according to the surface changed. Checkout/tender changes require the
full affected transaction-custody set, not only snapshot tests.

The final convergence closure should run `pnpm certify:static`; known
environment failures must be reported accurately and never relabeled PASS.

### Acceptance mapping

The UI campaign directly supports:

- A01: usable login/enrollment/preparation;
- A07-A10: offline readiness, expiry, resume, and clock-protection UX;
- A20: immutable offline receipt visibility;
- A31-A33: recovery, business conflict, and custody review;
- A36: unsupported offline cart explanation;
- A37-A38: scan/print failure presentation within supported scope;
- A45: sanitized failure/alert support path;
- A46-A47: reviewer and public-policy discoverability;
- A49: phone/tablet/keyboard/large-text/accessibility usability.

All existing acceptance results retain their recorded status. UI changes do
not automatically promote BLOCKED or NOT_RUN cases to PASS.

---

## 16. Data, API, security, and custody expectations

The expected impact for Slices 06-14 is:

```text
Neon/PostgreSQL migration: NONE EXPECTED
SQLite schema migration: NONE EXPECTED
SQLite reset: FORBIDDEN
POS v2 breaking API change: FORBIDDEN
Supabase Auth change: NONE EXPECTED
Transaction identity change: FORBIDDEN
Outbox/recovery deletion: FORBIDDEN
```

If a slice discovers that a UI requirement genuinely needs a new API field or
local persisted field:

1. stop treating it as presentation-only;
2. reproduce and document the functional gap;
3. design an additive, backward-compatible contract;
4. evaluate tenant/store authorization;
5. evaluate migration and downgrade behavior;
6. create a separately reviewable implementation slice;
7. retain unresolved custody throughout.

Never smuggle a database or protocol redesign into a styling commit.

---

## 17. Performance requirements

The redesigned UI must not sacrifice local-first responsiveness.

Required principles:

- catalogue interaction remains SQLite-backed when prepared;
- searching and category filtering must not generate per-keystroke cloud
  database traffic;
- product/card rendering must remain bounded for large catalogues;
- images need placeholders and bounded loading behavior;
- re-renders must not create duplicate scanner or checkout acceptance;
- readiness timers and lifecycle listeners must not multiply on navigation;
- animation must not block checkout actions or recovery visibility;
- diagnostics must not log sensitive payloads;
- telemetry must remain on the existing Phase 22/26 path.

Performance acceptance values should be measured on the agreed low-end device
and recorded during Slice 13 rather than invented in advance.

---

## 18. Visual evidence rules

Screenshots must be captured from a real running application state. Mockups may
guide design but may not be presented as Play or certification evidence.

Every evidence set must record:

- source commit;
- build type and artifact identity;
- package/version information;
- device model and Android API;
- viewport/orientation/font scale;
- employee permission class and synthetic tenant/store fixture;
- connection/readiness state;
- whether the screenshot is development, preview, or release-candidate
  evidence.

Do not include access tokens, passwords, secrets, real customer information,
or private merchant data in screenshots or logs.

The Google Play listing screenshots remain open until they come from the
actual approved release candidate and are reviewed against current Play
requirements.

---

## 19. Existing deferred production evidence

The UI campaign does not erase the deferred evidence register. At the baseline:

- A34 and A35 require a second physical Android terminal;
- A37 requires a compatible external HID scanner for the remaining physical
  claim;
- A38 requires a supported receipt printer;
- A39 and A40 require the deferred Store Hub environment if that feature is
  brought into release scope;
- A46 requires real Play reviewer credentials and the submitted build;
- A47 requires approved responsible entity/contact/domain and live public
  policy/support/deletion paths;
- A48 requires the real production-signed AAB;
- A49 requires the agreed physical phone/tablet, keyboard, large-text, and
  TalkBack evidence;
- A41 remains not applicable only while offline electronic/card payments stay
  disabled.

MOB-14 implementation is complete at its recorded repository boundary, but
production certification remains open.

---

## 20. Definition of UI implementation complete

MOB-13 UI convergence may be marked **IMPLEMENTATION COMPLETE** only when:

- Slices 06-14 have recorded outcomes;
- the main cashier checkout no longer appears as an engineering/certification
  form;
- web and mobile share an approved design contract;
- every mapped cashier screen has a deliberate native presentation;
- phone and tablet layouts are implemented;
- readiness, recovery, and custody states remain visible and correct;
- existing financial, offline, sync, security, and tenant tests pass;
- mobile/root typecheck, lint, Android export, and diff checks pass;
- physical Android evidence proves the core cashier flow;
- all limitations and unavailable hardware remain honestly recorded.

This status still does not mean production certified.

---

## 21. Definition of production UI certified

The UI is production-certified only when the exact signed release candidate:

- passes Phase 23 Android hardening and upgrade evidence;
- passes A48 artifact and Play-delivery checks;
- passes A49 on the agreed supported device classes;
- produces approved truthful listing screenshots;
- passes internal and closed testing;
- passes the real-store merchant pilot;
- retains acceptable crash, ANR, API, queue, and reconciliation behavior;
- has no release-blocking accessibility or cashier-workflow defect;
- is explicitly approved by the authorized product/release owner.

Until then, use:

```text
TINDIO POS UI CONVERGENCE: IMPLEMENTING / VALIDATING
PRODUCTION CERTIFICATION: NOT CERTIFIED
```

---

## 22. Immediate next action

Begin **MOB-13 Slice 06 - UI contract and screen inventory**.

Do not start by restyling the entire mobile checkout. First capture exact web
and native states, identify protected handlers and test IDs, establish the
token mapping, and select the smallest Slice 07 component boundary.
