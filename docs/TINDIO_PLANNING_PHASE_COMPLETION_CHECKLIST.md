# TINDIO Planning-Phase Completion Checklist

**Audit date:** 27 August 2026  
**Planning source:** `C:\Users\peral\Downloads\TINDIO_NEXT_PLANNING_MODE.md`  
**Scope:** Planning Document Phases 0–9 only. This is a repository comparison, not a substitute for hands-on acceptance testing with every role.

## How to read this checklist

- `[x]` Verified in the repository, migrations, tests, or completed implementation record.
- `[~]` Implemented for the agreed scope, with a stated limitation or intentional deferral.
- `[ ]` Still required before that phase can be called fully complete.
- `[?]` Requires manual, signed-in QA because source inspection alone cannot prove it.

## Overall result

| Planning phase | Status | Conclusion |
| --- | --- | --- |
| 0. Page Capability Audit | Complete | Historical audit exists. Some observations are now intentionally outdated because later phases changed the product. |
| 1. Global CRUD & Management UX Standard | Complete for approved management scope | Safe CRUD, guarded deletion, archival, RBAC and management UX were implemented. |
| 2. CSV Import / Export | Complete for priority business domains | Catalog, customers, suppliers and controlled inventory workflows are covered; optional future data types are deferred. |
| 3. Navigation & Information Architecture | Complete | Responsive Back Office navigation and RBAC-aware visibility are in place. |
| 4. Full-screen POS Operational Mode | Complete | POS is operationally separated from Back Office and gated by shift/register requirements. |
| 5. Automatic SKU & Barcode Generation | Complete | Collision-safe database generation, manual overrides, and Code 39 label printing are in place. |
| 6. Lightweight QR Loyalty Card | Complete for V1 | QR loyalty lifecycle, validation, rewards and auditing are implemented. Offline loyalty remains intentionally deferred. |
| 7. Smart Menu V1 | Complete | A view-only, catalog-backed public menu is available without creating a second catalogue. |
| 8. Presets-First Configuration UX | Complete | Payment, dining, receipt and role configuration now lead with safe presets while retaining custom options. |
| 9. Global UI Consistency & Quality Pass | **Partially complete** | Core shared presentation improvements are implemented, but a final all-page consistency and signed-in QA pass is still needed. |

**Bottom line:** Do not restart any completed phase. Close the remaining Phase 9 checklist below, then the Planning Document will be fully complete. The source document has no Phase 10.

---

## Phase 0 — Page Capability Audit

Primary evidence: [`docs/TINDIO_PAGE_CAPABILITY_MATRIX.md`](./TINDIO_PAGE_CAPABILITY_MATRIX.md)

- [x] Back Office pages and capabilities were inventoried.
- [x] Existing create/read/update/delete behaviors were mapped.
- [x] CSV import/export opportunities and higher-risk record types were identified.
- [x] Candidate configuration presets were identified.
- [x] Security/RLS-sensitive areas were explicitly separated from ordinary UI work.
- [x] The audit informed the later Phases 1–9 scope.
- [~] The matrix is a historical baseline, not a live product specification. For example, its original observations about missing shared dialogs and Smart Menu are no longer true after later phases.

**Phase 0 result:** Complete. Keep the capability matrix as history, but do not use its older implementation observations as the current product state.

---

## Phase 1 — Global CRUD & Management UX Standard

Primary evidence: commit `91107df`, guarded-delete component, management/catalog/customer feature modules.

### 1.1 Create, read, update and management flows

- [x] Safe management entities have create, read, update and delete/archive paths appropriate to their data model.
- [x] Customer, catalog, store, register, employee, role and configuration management modules have structured forms and actions.
- [x] Server actions and service layers retain authorization and validation boundaries instead of trusting browser input.
- [x] Existing Supabase RLS and PostgreSQL RPC boundaries were preserved.
- [x] Forms use dialog/modal workflows where that is appropriate; complex product/catalog workflows remain dedicated forms where a modal would reduce usability.

### 1.2 Delete, archive and irreversible actions

- [x] A shared guarded-delete pattern exists in [`src/components/back-office/guarded-delete-dialog.tsx`](../src/components/back-office/guarded-delete-dialog.tsx).
- [x] Destructive actions explain the effect and require deliberate confirmation.
- [x] Archive is used for records that should be retained for history rather than erased.
- [x] Permanent deletion is available only where the record and authorization rules allow it.
- [x] Financial and other immutable records are not treated as ordinary deletable data.

### 1.3 Permissions and role clarity

- [x] Create/update/archive/delete actions are permission-gated in the UI and enforced on the server/database boundary.
- [x] Role permissions can be reviewed in the role-management experience.
- [x] The condensed permission list expands to show the additional permissions instead of only presenting a number.

### 1.4 Practical limits

- [~] Search, filters and pagination are present where the data volume or page workflow needs them; they are not a forced visual control on every small management list.
- [~] A universal “one form layout for every entity” was intentionally avoided. Product and inventory workflows have more fields and need different interaction patterns.
- [?] Run a role-by-role smoke test to confirm the exact actions available to Cashier, Manager and Administrator accounts match the desired business policy.

**Phase 1 result:** Complete for the approved safe management scope.

---

## Phase 2 — CSV Import / Export

Primary evidence: commit `111f267`, catalog/customer/supplier/inventory CSV modules and export routes.

### 2.1 Supported imports

- [x] Catalog/product CSV template, parsing, validation and import workflows exist.
- [x] Customer CSV template, validation and import workflow exist.
- [x] Supplier CSV template, validation and import workflow exist.
- [x] Inventory CSV tools support controlled count, purchase and adjustment workflows rather than directly mutating stock projections from arbitrary client input.
- [x] Preview/validation feedback is shown before the relevant import is committed.
- [x] Import paths retain server-side validation and database/RPC controls.

### 2.2 Supported exports

- [x] Catalog export exists.
- [x] Customer export exists.
- [x] Supplier export exists.
- [x] Report export exists.
- [x] Organization export exists where permitted.
- [x] CSV encoding was later centralized in [`src/lib/csv.ts`](../src/lib/csv.ts) to retain correct quoting, comma escaping and CRLF output across exports.

### 2.3 Deferred data types

- [~] Price-list, additional configuration, and other optional import/export domains remain future additions, as identified by the original audit. They were not required to complete the selected priority scope.
- [x] High-risk financial history was not exposed as a casual mutable CSV import.

**Phase 2 result:** Complete for the priority business domains selected in the planning work.

---

## Phase 3 — Navigation & Information Architecture

Primary evidence: commit `341f5a4`, [`src/components/back-office/back-office-navigation.tsx`](../src/components/back-office/back-office-navigation.tsx), [`src/app/(back-office)/back-office/layout.tsx`](../src/app/(back-office)/back-office/layout.tsx).

- [x] Back Office navigation is grouped into clear operational sections.
- [x] Desktop navigation is persistent/sticky for efficient management work.
- [x] Mobile navigation is available from the Back Office layout.
- [x] Navigation items are filtered by the user’s permissions rather than merely hidden cosmetically after navigation.
- [x] Active navigation state is exposed accessibly with `aria-current`.
- [x] The navigation is separated from the POS operational route group.
- [x] The information architecture supports the previously added management, catalog, inventory, sales and configuration modules.
- [?] Test with a restricted account to confirm that unavailable Back Office sections are not shown and direct URL access is still denied.

**Phase 3 result:** Complete.

---

## Phase 4 — Full-screen POS Operational Mode

Primary evidence: [`src/features/pos/pos-terminal.tsx`](../src/features/pos/pos-terminal.tsx), [`src/app/(pos)/pos/page.tsx`](../src/app/(pos)/pos/page.tsx), shift/register database tests.

- [x] POS uses a dedicated route/layout context and is not presented as another Back Office sidebar page.
- [x] The terminal uses a full-screen operational layout.
- [x] The shift gate prevents ordinary selling activity until the required register/shift conditions are satisfied.
- [x] Time clock, store/register selection and opening-cash setup remain part of the operational entry flow.
- [x] Frontend controls prevent sale completion when the POS is not operational.
- [x] Server/database authorization and RPC boundaries remain the authoritative enforcement point.
- [x] POS checkout, shifts and stock integrity were preserved rather than mechanically refactored into unsafe UI-only logic.
- [?] Manual test: close a shift, refresh the POS, attempt to add/complete a sale, then open a new shift and verify normal selling resumes.

**Phase 4 result:** Complete.

---

## Phase 5 — Automatic SKU & Barcode Generation

Primary evidence: commit `0630abe`, migration `20260826140626_phase_5_automatic_sku_barcode_generation.sql`, [`src/features/catalog/code39.ts`](../src/features/catalog/code39.ts), [`src/features/catalog/catalog-label-print.tsx`](../src/features/catalog/catalog-label-print.tsx).

- [x] SKU and barcode values can be generated automatically for new products.
- [x] Generation is collision-safe at the database boundary, not only in browser code.
- [x] Users can manually enter/edit valid product codes when business operations require it.
- [x] Product UI distinguishes generated versus existing/manual code use.
- [x] Code 39 label rendering/printing is available for product labels.
- [x] Archived products are not casually treated as safe sources for code reuse.
- [x] Migration/database tests cover the critical generator behavior.
- [~] Advanced label quantities, custom paper sizes and printer integrations are enhancement work, not required for Phase 5’s V1 definition.

**Phase 5 result:** Complete.

---

## Phase 6 — Lightweight QR Loyalty Card

Primary evidence: commit `f1634e1`, migration `20260827110000_planning_phase_6_lightweight_qr_loyalty_cards.sql`, loyalty card feature modules, public verification route.

### 6.1 Loyalty card lifecycle

- [x] Customers can receive a loyalty card with a unique QR identity.
- [x] Cards can be issued, replaced, revoked and their status recorded.
- [x] Stamps/rewards are recorded through controlled actions and auditable events.
- [x] Reward claim lifecycle is recorded rather than silently overwriting customer history.
- [x] The card can be printed for a physical stamp-card workflow.

### 6.2 QR security and verification

- [x] QR content does not expose a live editable reward/stamp count as its source of truth.
- [x] The public verifier resolves the current server-side card state.
- [x] Verification handles valid, claimed, revoked, replaced, expired and invalid outcomes.
- [x] The public route is view-only; it does not allow a QR scan to mutate loyalty data.

### 6.3 V1 boundary

- [~] Offline loyalty reconciliation was intentionally not added in V1. The planning source explicitly advises against over-engineering offline loyalty before the core flow is proven.
- [?] Test with a customer, issue a card, scan its printed QR, award a stamp, claim a reward, then scan again to confirm each status message.

**Phase 6 result:** Complete for V1.

---

## Phase 7 — Smart Menu V1

Primary evidence: commit `82a1efb`, migrations `20260827120000_planning_phase_7_smart_menu.sql` and `20260827130000_planning_phase_7_smart_menu_rls_policy_repair.sql`, Smart Menu modules, public `/menu/[menuId]` route.

- [x] Smart Menu configuration is managed from an authorized Back Office page.
- [x] Smart Menu does not create or maintain a duplicate product catalogue.
- [x] Existing catalog categories and products can be selected for a menu.
- [x] Selected categories/products can be ordered for customer-facing presentation.
- [x] The public menu is read-only; online ordering and checkout are outside V1.
- [x] Product name, price, availability and supported catalog presentation data flow from the catalog-backed source rather than a manually duplicated product record.
- [x] Public menu access is deliberately narrow and supported by database policies/functions.
- [x] RLS policy repair was applied to keep the feature’s intended security model working.
- [~] The menu is a V1 discovery/menu display feature. Rich ordering, payment, table service and broad marketing-site features remain separate future work.
- [?] Test a disabled product, a changed price and reordered category from a staff account, then refresh the public menu URL to verify that public display follows the approved configuration.

**Phase 7 result:** Complete for V1.

---

## Phase 8 — Presets-First Configuration UX

Primary evidence: migration `20260827140000_planning_phase_8_presets_first_configuration.sql`, payment/receipt/roles/advanced-sales configuration modules, database test `planning_phase_8_presets_first_configuration.test.sql`.

### 8.1 Payments and receipt settings

- [x] Payment configuration separates TINDIO presets from custom methods.
- [x] Safe default payment methods include Cash, Card, GCash, Maya and Bank Transfer.
- [x] Removed default payment presets can be restored through a controlled database RPC.
- [x] Receipt configuration offers layout presets alongside customization.
- [x] Reserved default payment codes cannot be repurposed as arbitrary custom methods.

### 8.2 Dining and roles

- [x] Dining-option setup presents preset workflows alongside custom options.
- [x] Roles are clearly grouped as system roles and custom roles.
- [x] System-role behavior is protected from being casually converted into a different custom-role definition.

### 8.3 Deliberate boundaries

- [~] No universal tax/discount preset was invented because taxation and discount law varies by jurisdiction. Custom configuration remains available; localized legal templates are future work.
- [x] The phase does not duplicate the underlying configuration models simply to create a preset UI.
- [x] Database tests, typecheck, lint, build and database advisors were run during the phase. The recorded database suite result was 37 files / 851 tests passing.

**Phase 8 result:** Complete.

---

## Phase 9 — Global UI Consistency & Quality Pass

Primary evidence: [`src/components/back-office/page-header.tsx`](../src/components/back-office/page-header.tsx), [`src/components/back-office/back-office-state-card.tsx`](../src/components/back-office/back-office-state-card.tsx), and the current Phase 9 page changes.

### 9.1 Completed implementation work

- [x] `PageHeader` now wraps action areas responsively instead of allowing cramped header actions to overflow on smaller screens.
- [x] A reusable Back Office state-card component was introduced for clear empty, loading/error and no-access presentation where applied.
- [x] Consistent state cards were applied to Categories, Customers, Receipts, Stores, Registers, Employees and Inventory.
- [x] The pages touched in this pass retain permission/no-access messaging instead of leaving blank or ambiguous content.
- [x] Typecheck passed.
- [x] Lint passed with the same known pre-existing `<img>` warning in the catalog page.
- [x] Production build passed all 45 routes.

### 9.2 Items still needed for strict Phase 9 completion

- [ ] Review **every** remaining management/configuration page for consistent empty, loading, error and no-permission states. The new component has not yet been applied universally.
- [ ] Review page headers/actions across every Back Office route, not only the pages touched in this pass.
- [ ] Establish/verify a consistent search, filter and pagination pattern wherever a page can grow beyond a small operational list.
- [ ] Perform a signed-in desktop and mobile visual QA pass. Browser inspection without a user session can only confirm the login redirect, not protected-page quality.
- [ ] Perform keyboard/focus testing for dialogs, dropdowns, drawers and destructive-action confirmations.
- [ ] Update the landing-page milestone copy. It still refers to an earlier “Cash checkout” milestone and no longer represents the current product capabilities.
- [ ] Record/fix any real QA findings discovered by the complete pass.

**Phase 9 result:** Partially complete. The reusable foundation and selected-page improvements are done; the all-page quality sweep is the remaining work.

---

## Recommended closure order

1. Finish the Phase 9 all-page consistency sweep.
2. Run the signed-in manual QA matrix below with Administrator, Manager and Cashier accounts.
3. Fix only confirmed QA findings.
4. Re-run typecheck, lint, build and the relevant Supabase database tests.
5. Mark Phase 9 complete and treat the Planning Document as fully delivered.

## Final manual QA matrix

| Area | Minimum acceptance test |
| --- | --- |
| Roles | Sign in as each role; confirm navigation, direct URLs and actions match permission policy. |
| CRUD | Create, edit, archive and permanently delete a safe test record; confirm the guarded dialog and result state. |
| CSV | Export a template/data set, import a valid row, then import invalid rows and confirm preview/validation rejects them safely. |
| Navigation | Check desktop, narrow mobile width, keyboard navigation and active-page state. |
| POS | Start shift, sell a product, close shift, refresh, then confirm the gate blocks transactions until reopened. |
| Product codes | Create auto-generated and manual-code products, print a label, and verify duplicates are refused. |
| Loyalty | Issue, print and scan a QR card; award/claim/revoke as appropriate and verify public statuses. |
| Smart Menu | Change selected menu products/order/availability; refresh public menu and confirm it follows catalog/configuration. |
| Presets | Remove/restore a default payment method and test a custom method without changing protected presets. |
| UI quality | Visit every Back Office page at desktop/mobile widths; confirm headers, action buttons, empty/error/no-access states and focus behavior. |

