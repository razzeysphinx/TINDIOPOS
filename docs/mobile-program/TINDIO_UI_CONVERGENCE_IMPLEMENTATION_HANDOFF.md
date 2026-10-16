# TINDIO UI Convergence Implementation Handoff

Status: **READY FOR NEXT CHAT - IMPLEMENTATION NOT STARTED**

Prepared: **2026-10-16**

Branch: **TINDIO-PREPRODUCTION**

Handoff baseline: **f9d4594c4e175bdf7a8fb8060ca77bc70be98752**

This handoff contains the context needed to continue the TINDIO POS web/mobile
UI convergence campaign without interpreting previous functional-parity work
as completed visual parity.

---

## 1. First instruction for the next chat

Read these files completely before changing code:

1. `AGENTS.md`
2. `apps/mobile/AGENTS.md`
3. `docs/TINDIO_MOBILE_NEON_SOURCE_OF_TRUTH.md`
4. `docs/recovery/TINDIO_NEON_RECOVERY_SOURCE_OF_TRUTH.md`
5. `docs/mobile-program/TINDIO_POS_WEB_MOBILE_UI_SOURCE_OF_TRUTH.md`
6. `docs/mobile-program/PHASE_13_NATIVE_CASHIER_PARITY.md`
7. `docs/mobile-program/MOB_13_SLICE_01_CASHIER_HOME_SUPPORT_BOUNDARY.md`
8. `docs/mobile-program/MOB_13_SLICE_02_RELEASE_INPUT_CONTRACT.md`
9. `docs/mobile-program/MOB_13_SLICE_03_BRANDING_LISTING_CANDIDATE.md`
10. `docs/mobile-program/MOB_13_SLICE_04_PHYSICAL_BRANDING_UI_REVIEW.md`
11. `docs/mobile-program/MOB_13_SLICE_05_RELEASE_READINESS_HANDOFF.md`
12. `docs/mobile-program/MOB_10_DEFERRED_EVIDENCE_REGISTER.md`
13. `docs/mobile-program/PHASE_23_ANDROID_PRODUCTION_HARDENING.md`
14. `docs/mobile-program/PHASE_24_GOOGLE_PLAY_TESTING_RELEASE.md`
15. the supplied `TINDIO-MOBILE-PRODUCTION-PLAN.md`
16. the supplied `TINDIO-REPOSITORY-AUDIT.md`
17. the supplied `SOL-IMPLEMENTATION-HANDOFF.md`
18. the supplied `TINDIO-ACCEPTANCE-MATRIX.md`

Do not rely on this handoff alone when a listed source is available.

---

## 2. User-approved product direction

The user wants the native Android POS and web POS to look and operate like one
TINDIO product before continuing toward production release.

The approved interpretation is:

- shared visual language and cashier workflow;
- separate web and native renderers;
- no WebView;
- no React Native Web rewrite;
- preserve the existing Expo application;
- preserve all current backend, offline, custody, security, and synchronization
  architecture;
- perform small, independently validated vertical slices.

The user explicitly requested that the new UI source-of-truth document become
the base source of truth for this work.

---

## 3. Repository state at handoff creation

```text
Branch: TINDIO-PREPRODUCTION
HEAD: f9d4594c4e175bdf7a8fb8060ca77bc70be98752
Remote tracking: origin/TINDIO-PREPRODUCTION
Working tree before adding these documents: clean
```

Recent commits at the time of preparation:

```text
f9d4594 fix(mobile): close MOB-14 observability gaps
3a91624 Harden Android exit reconciliation
ed0b50e Protect production Android submission
83046e0 Harden Phase 24 production evidence gate
2aca482 feat(mobile): add release readiness handoff
5d57e92 feat(mobile): harden physical recovery UI
fa106af feat(mobile): add TINDIO release branding candidates
3fd3403 build(mobile): gate production release inputs
a35d54f feat(mobile): brand cashier home and guard diagnostics
917cfbc feat(mobile): define v1 hardware support scope
7cb8d5f feat(mobile): defer Store Hub from v1 release
e30bf58 docs(mobile): preserve deferred MOB-10 evidence
```

Before implementation, fetch/inspect the latest approved branch, record the
new exact starting commit, and determine whether any changes after this
baseline affect the findings.

Do not overwrite unrelated user changes if the tree is no longer clean.

---

## 4. Current technical baseline

Mobile package versions observed at handoff creation:

```text
Expo: ~57.0.27
React: 19.2.3
React Native: 0.86.3
Expo Router: ~57.0.25
Android package: com.tindio.pos
```

The mobile application already implements significant functional behavior:

- authentication and business context;
- device enrollment and terminal preparation;
- readiness/authorization lifecycle;
- SQLite catalogue and customer cache;
- local-first search and cart estimates;
- online cash checkout;
- durable supported offline cash sale;
- stable checkout identity and ambiguous retry handling;
- outbox synchronization and recovery;
- receipt history/detail;
- customers, tickets, shifts, transfers, and time clock;
- support/diagnostic routes with permission boundaries;
- camera barcode path and manual barcode/SKU entry;
- crash/restart/upgrade/telemetry protections.

Do not rebuild these systems while implementing presentation work.

---

## 5. Observed UI defect

The web POS is a structured, responsive cashier workspace. Its main sources
include:

- `src/features/pos/pos-terminal.tsx`
- `src/features/pos/pos-v2-terminal-shell.tsx`
- `src/features/pos/pos-workspace-header.tsx`
- `src/features/checkout/payment-screen.tsx`
- `src/features/customers/pos-customer-picker.tsx`
- `src/features/pos/pos-operational-drawer.tsx`
- `src/app/globals.css`
- `src/components/ui/*`

The native checkout in `apps/mobile/app/(app)/pos.tsx` is functionally rich but
visually remains a certification/engineering surface. At the baseline it is a
large route with raw `Text`, `TextInput`, `Pressable`, inline styles, and a long
scrolling layout. It exposes copy such as:

- `LOCAL-FIRST POS`;
- `Catalog source: SQLite`;
- business/store/register internal IDs;
- `LOCAL PREVIEW ONLY`;
- verbose inventory diagnostics;
- current checkout operation information.

This is not production visual parity even though Phase 13 functional tests
pass.

The mobile home received some branded/recovery styling in MOB-13 Slice 04, but
the complete cashier flow was not redesigned or physically certified.

---

## 6. Correct status of existing work

Retain these conclusions:

- Phase 13 functional implementation: complete at its recorded scope.
- MOB-13 Slices 01-05: complete at their recorded scopes.
- MOB-14 source implementation: complete at its recorded scope.
- Full native cashier visual parity: not implemented.
- MOB-13 UI convergence Slices 06-14: open.
- Phase 23/24 production certification: open.
- A48: NOT_RUN until the real production-signed AAB exists.
- A49: BLOCKED pending required physical phone/tablet/accessibility evidence.

Do not rewrite historical evidence to pretend it certified something it did
not test. Add new evidence for the reopened UI scope.

---

## 7. Immediate next slice

Proceed with:

```text
MOB-13 Slice 06 - UI contract and screen inventory
```

This is an audit/specification slice. Do not begin the broad visual refactor in
the same change.

### Slice 06 required work

1. Verify branch, HEAD, remote state, and working tree.
2. Read all sources listed in Section 1.
3. Inspect the complete web POS and native mobile routes.
4. Run both applications in representative states where safely possible.
5. Capture/reference web desktop, web compact, native phone, and native tablet
   states using synthetic data only.
6. Inventory every cashier screen, modal, sheet, empty state, loading state,
   error state, restriction state, and recovery state.
7. Map each web element to the required native interaction.
8. Identify existing native handlers, hooks, services, test IDs, and custody
   boundaries that presentation work must preserve.
9. Inventory current web CSS variables and reusable UI controls.
10. Propose the smallest framework-neutral token format and location.
11. Produce the required KEEP / KEEP + HARDEN / EXTEND / REFACTOR / REPLACE /
    REMOVE / NEW matrix.
12. Record exact expected files for Slice 07.
13. Add behavioral/source checks for the UI contract only if they provide real
    regression value.
14. Validate documentation and repository checks proportionate to a docs/audit
    slice.
15. Commit one focused Slice 06 change and report the exact commit.

### Slice 06 expected deliverable

Create a dedicated evidence/specification file, recommended name:

```text
docs/mobile-program/MOB_13_SLICE_06_UI_CONTRACT_SCREEN_INVENTORY.md
```

It should refine, not replace,
`TINDIO_POS_WEB_MOBILE_UI_SOURCE_OF_TRUTH.md`.

---

## 8. Planned sequence after Slice 06

Do not combine these into one large commit:

1. Slice 07 - shared semantic tokens and native primitives.
2. Slice 08 - cashier shell, navigation, and readiness presentation.
3. Slice 09 - catalogue/search/scanner/product presentation.
4. Slice 10 - cart and inventory presentation.
5. Slice 11 - tender, checkout, and receipt result.
6. Slice 12 - customers, tickets, receipts, shifts, transfers, time clock,
   recovery, settings, and diagnostics.
7. Slice 13 - responsive, accessibility, and low-end-device hardening.
8. Slice 14 - physical Android UI certification and release handoff.

The detailed gates are in the UI source of truth.

---

## 9. Protected code and behavior

Before modifying `apps/mobile/app/(app)/pos.tsx`, identify and preserve:

- local catalogue/search calls;
- barcode duplicate guard;
- cart identity and mutation behavior;
- variable-price and modifier validation;
- total calculations;
- stock estimate refresh;
- customer cache and online search/create boundary;
- online checkout intent persistence and retry identity;
- offline sale creation and durable commit-before-success behavior;
- authorization expiry/revalidation;
- shift/register matching;
- online/offline eligibility;
- sync coordinator use;
- test IDs used by physical and behavioral evidence.

Also preserve:

- `apps/mobile/src/features/outbox/*`;
- local database schema and migrations;
- checkout-intent and recovery stores;
- session/business/device providers;
- tenant/store receipt filters;
- Expo Router permission guards;
- Phase 22/26 telemetry path;
- root crash/exit reconciliation;
- existing web POS behavior unless a separately reproduced web defect is in
  scope.

UI components may invoke these paths; they must not duplicate them.

---

## 10. Expected impact

For normal UI convergence slices:

```text
Neon migration: NONE
SQLite migration/reset: NONE
POS v2 breaking change: NONE
Supabase Auth change: NONE
Tenant/store enforcement change: NONE
Transaction identity change: NONE
Outbox/recovery deletion: NONE
```

If inspection shows otherwise, stop and split the functional change into a
separate compatibility-reviewed slice.

---

## 11. Test and evidence expectations

Every implementation slice must run targeted behavior checks and the affected
phase suites. Before closing a typical UI implementation slice, run at least:

```text
pnpm mobile:typecheck
pnpm typecheck
pnpm --dir apps/mobile lint
pnpm lint
pnpm mobile:export:android
git diff --check
```

Run affected Phase 06/08/09/10/13/14/16/17/18/21/22/23 suites as appropriate.
Any tender or acceptance UI change requires transaction-custody and
authorization-expiry regression coverage.

Physical evidence must record the source commit, artifact identity, package
version, device/API, layout/font configuration, synthetic fixture, and actual
result. Screenshots alone do not prove financial or custody behavior.

Do not mark the mobile application production-ready because typecheck, source
contracts, snapshots, or an Android JavaScript export pass.

---

## 12. Known release blockers that remain outside UI implementation

From `MOB_10_DEFERRED_EVIDENCE_REGISTER.md` and the Phase 23/24 handoffs:

- A34/A35: second physical device unavailable;
- A37: remaining external HID scanner proof unavailable;
- A38: receipt printer proof unavailable;
- A39/A40: real Store Hub network/trusted transport deferred from v1 scope;
- A46: actual Play reviewer credential/build walkthrough blocked;
- A47: approved public legal/support/deletion inputs and live origin blocked;
- A48: production-signed AAB not created;
- A49: complete low-end phone/tablet/keyboard/large-text/TalkBack proof blocked;
- production EAS owner/project, origins, publishable configuration, signing
  inspection, final brand/listing approval, support email, and release-candidate
  screenshots remain subject to the release-readiness audit;
- merchant pilot evidence remains open.

Offline electronic/card payments remain disabled. A41 becomes applicable only
if a compliant PSP and supported offline payment protocol enter release scope.

---

## 13. Physical Android context from the preceding session

This context is transient and must be reverified; it is not a guarantee about
the next chat environment.

Previously observed:

```text
Physical device: Xiaomi 21121210G
Android: 14 / API 34
ADB serial: 82eaaf10
Installed package: com.tindio.pos
Installed versionCode: 2
App firstInstallTime was preserved through in-place updates
Installed signer SHA-256:
fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c
Preserved pre-update APK outside repository:
C:\tmp\TINDIOPOS-before-phone-ui-20261016.apk
Preserved APK SHA-256:
B5B349B77788CC5640680E27F9A59475852F6A8A6940D93FB3FF82E9D8F1A59C
```

The phone previously reached `Connected to TINDIO` and `READY OFFLINE` through
an ADB reverse connection to a local backend and displayed the full cashier
checkout. That runtime view exposed the plain engineering-style UI gap.

Do not assume the backend process, ADB path, USB connection, port reverse, app
authorization, or readiness is still active. At handoff preparation time, ADB
was not available on the current shell PATH and the prior local listener could
not be confirmed. Locate tools safely and reverify rather than clearing app
data or reinstalling.

Do not uninstall, clear application data, reset SQLite, replace credentials,
or delete unresolved custody merely to restore a screenshot state.

---

## 14. Development environment cautions

- The root `AGENTS.md` says the installed Next.js version has breaking changes.
  Read the relevant local Next documentation before editing Next.js code.
- `apps/mobile/AGENTS.md` requires checking Expo SDK 57 documentation before
  changing Expo, EAS, or React Native APIs.
- The Expo Router instructions in the agent file refer generically to
  `src/app`; this repository currently uses `apps/mobile/app`. Preserve the
  actual working repository convention unless a verified SDK rule requires a
  scoped change.
- Use `apply_patch` for manual file edits.
- Preserve unrelated working-tree changes.
- Do not add dependencies until current capabilities and SDK compatibility are
  audited.
- Do not edit generated native directories by hand if the project is using
  Continuous Native Generation; use supported Expo configuration/plugins.

---

## 15. Slice reporting format

For every completed slice, report:

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

Use only PASS, FAIL, BLOCKED, or NOT_RUN for acceptance cases unless the
acceptance matrix explicitly permits and documents another status.

---

## 16. Stop conditions

Stop and report before expanding scope if the UI work reproduces or risks:

- duplicate sale, payment, receipt, or inventory effect;
- changed retry identity;
- lost accepted transaction;
- hidden or deleted pending custody;
- cross-tenant or cross-store leakage;
- authorization bypass;
- migration requiring destructive reset;
- incompatible backend contract;
- need for a new native dependency not yet verified against Expo SDK 57;
- apparent need to rebuild the app or embed the website;
- a dirty-tree overlap that cannot be preserved safely.

Do not use presentation pressure as a reason to bypass these conditions.

---

## 17. Suggested opening request for the next chat

```text
Continue from the current TINDIO-PREPRODUCTION HEAD. Read the complete UI
source of truth and implementation handoff, verify current HEAD and changes
since f9d4594c4e175bdf7a8fb8060ca77bc70be98752, and proceed only with MOB-13
Slice 06 - UI contract and screen inventory. Do not begin the broad UI rewrite
or MOB-13 Slice 07 in the same change. Preserve the existing Expo app, backend,
SQLite/outbox/custody architecture, transaction identities, tenant/store
security, and all recorded acceptance statuses. Produce the gap matrix, exact
screen/state inventory, protected-code map, design-token inventory, expected
Slice 07 files, validation results, focused commit, and next smallest safe
slice.
```
