# TINDIO Final Pre-Production — Phase 0 Audit

**Audit date:** 27 August 2026  
**Target specification:** `C:\Users\peral\Downloads\TINDIO_FINAL_PREPRODUCTION_IMPROVEMENT_BUILD.md`  
**Audit method:** Non-destructive repository and local Supabase inspection. No application behavior, database schema, migration, policy, function, route, or production data was changed.

## Required Phase Report

**PHASE:**

Phase 0 — Final Architecture & Destructive-Change Audit

**STATUS:**

Complete — audit and engineering gate passed. Phase 1 has **not** started.

**AUDIT COMPLETED:**

- Route, layout, navigation and workspace ownership inventory.
- Permission, role, action/service/data and API-route inventory.
- Local migration-state, table, RLS, policy and RPC inspection.
- Checkout, payment, refund, shift, cash, inventory, device and offline dependency review.
- Comparison against the final pre-production target specification.
- Candidate-for-removal assessment with the required no-delete rule.

**WHAT EXISTED BEFORE:**

TINDIO is already one deployable Next.js 16 application with two effective route groups:

```text
/(back-office)/back-office/*  -> Back Office layout
/(pos)/pos                    -> POS terminal
```

The established server boundary remains:

```text
UI / pages
  -> Server Actions or route handlers
  -> feature service/data layers where appropriate
  -> Supabase server client / PostgreSQL RPC
  -> PostgreSQL + RLS
```

Authentication uses verified Supabase claims. `BusinessContext` resolves the authenticated user, profile, active employee, organization, assigned stores, role names, effective permissions, tenant-readiness rights, and feature settings. There is no service-role key in browser code and no standalone backend process.

**WHAT CHANGED:**

Only this Phase 0 audit document was added. No production behavior was changed.

**FILES CHANGED:**

- `docs/TINDIO_FINAL_PREPRODUCTION_PHASE_0_AUDIT.md` — this audit report only.

**FILES MARKED CANDIDATE_FOR_REMOVAL:**

None.

The following are **CANDIDATE_FOR_RELOCATION**, not deletion candidates:

| Current item | Why it differs from the target | Known impact | Safe future treatment |
| --- | --- | --- | --- |
| `Open POS` in Back Office Sales navigation | The target makes POS a separate operational workspace rather than an ordinary Back Office destination. | It is currently permission-visible to users with `sales.create`; no backend sale authority depends on the sidebar link. | Phase 1 should replace it with a workspace-entry pattern. Preserve `/pos` and its server gate. |
| `/back-office/shifts` and `ShiftManager` operational controls | The target keeps shift history/reporting in Back Office but moves open/close/pay-in/pay-out operations into POS. | It currently owns working UI for opening/closing shifts and cash movements. The RPCs, audit trail and historical display must remain intact. | Phase 1/5 should relocate UI responsibilities only. Do not delete actions, RPCs, migration history, cash records, or shift history. |
| POS header links to Back Office shift/time-clock pages | The target calls for POS-focused navigation rather than reliance on Back Office navigation during register work. | Time clock and historical shift pages are valid capabilities; only their entry placement needs review. | Phase 4 should consolidate operational links into a POS drawer/menu while preserving direct, authorized routes. |

**DATABASE CHANGES:**

None. The local database was inspected read-only.

**MIGRATIONS:**

- 99 local migrations are present and match the configured migration history.
- The local live schema contains 90 public tables.
- Migration source contains 123 PostgreSQL function definitions, including private helpers and public RPCs.
- Static migration review found 153 policy definitions.
- No migration was created, edited, reset, pushed, or removed.

**RLS / SECURITY CHANGES:**

None.

Audit result:

- The live local schema reports **90/90 public tables with RLS enabled**; there are no RLS-disabled public tables.
- The migration-text scan is not itself a substitute for live schema inspection because policies/RLS may be introduced or repaired in later migrations. The live schema result is authoritative for this audit.
- Sensitive database commands remain in PostgreSQL RPCs, including checkout, refunds, register shifts, cash movements, inventory adjustments, device validation/revocation, loyalty and offline-sync event recording.
- Inspected public `SECURITY DEFINER` functions use an empty fixed `search_path` (`search_path=""`). Functions intentionally public to `anon` are limited to token/public-display cases: customer-display bootstrap/receipt, public Smart Menu retrieval, and loyalty QR verification. Other inspected sensitive functions are not `anon` callable.
- Database advisors reported no local security or performance issue at warning-or-higher level.

**BACKEND CHANGES:**

None.

Current backend command map:

| Domain | Primary server boundary | Authoritative database boundary |
| --- | --- | --- |
| Checkout / payments | `checkout-service.ts`, server action, `/api/pos/checkout`, `/api/pos/offline-checkout` | `checkout_advanced_sale` with idempotency key, store/register/shift/device validation and atomic receipt/payment/inventory outcome |
| Refunds | `receipts/actions.ts` | `refund_sale` with idempotency key, authorization/approval handling and inventory/payment history |
| Shifts / cash | `shifts/actions.ts` | `open_register_shift`, `close_register_shift`, `record_cash_movement`, `get_shift_cash_summary` |
| Inventory | inventory action modules | controlled adjustment, count, receiving, transfer, replenishment and production RPCs |
| Devices | `devices/actions.ts` | device registration, validation, rebinding and revocation RPCs |
| Offline sync | `/api/pos/offline-checkout` | canonical checkout RPC plus `record_offline_sync_event` telemetry |
| Team / roles | management actions/services | invitation, employee assignment and custom-role RPCs with organization scope |
| Business / feature settings | business-profile action/service | `update_business_profile_features` and feature data retained by organization |

**FRONTEND CHANGES:**

None.

Current route and workspace inventory:

| Workspace / exposure | Current routes | Current access model |
| --- | --- | --- |
| Public and authentication | `/`, `/login`, `/signup`, `/auth/*`, `/join`, `/onboarding`, `/organization-paused`, `/offline` | Public/auth-flow specific; onboarding requires a signed-in user before organization creation. |
| Public token/read-only surfaces | `/menu/[menuId]`, `/loyalty/verify/[cardId]`, `/customer-display/[token]`, customer-display receipt route | Narrow public/token database functions rather than ordinary Back Office permission access. |
| Back Office | 24 routes under `/back-office`, including dashboard, reports, sales history, catalog, inventory, customers, team, management and settings | The layout requires active `BusinessContext`; individual pages/actions use varying permission gates. |
| POS | `/pos` | Direct server route gate requires `sales.create`; operational terminal separately gates product/cart/payment use until an active shift exists. |
| Kitchen | `/kitchen` | Server route checks `kitchen.view` or `kitchen.manage`. |
| API routes | 12 route handlers: exports plus POS catalog, customer, modifier, device, customer-display, checkout and offline-checkout APIs | Authenticated context and appropriate permission/scope checks; public operations use their dedicated token mechanisms. |

Existing feature pattern is already suitable for the final build: shared contracts/schemas, server actions as adapters, server-only services/data modules, and Supabase/RPC boundaries. Existing feature modules cover advanced sales, approvals, business profile, catalog, checkout, customers, devices, kitchen, management, onboarding, organization readiness/recovery, payments, POS, receipts, reports, shifts, Smart Menu and time clock.

**ROLE ACCESS IMPACT:**

No role behavior changed.

Current bootstrap creates five system roles:

| Role | Current default intent |
| --- | --- |
| Owner | All permission records. |
| Admin | All except `organization.manage`. |
| Manager | Store/operational sales, refunds, discounts, price override, receipts, shifts, cash, catalog, inventory, customers, limited employee management, reports, registers and dashboard. |
| Cashier | POS selling, discounts, receipts/reprints, shifts and cash movements. |
| Inventory Staff | Catalog cost/product and inventory management. |

Effective access is not based on a role name alone. `BusinessContext` derives permissions from employee-role links and resolves assigned store IDs from employee-store links. Sensitive commands also receive the organization/store/register/shift/device identifiers required by their RPCs.

### Important Phase 1 target gap

The target specification says Cashiers should not receive Back Office management by default. The current implementation correctly blocks sensitive commands, but the **Back Office layout itself only requires `BusinessContext`**. Several sidebar destinations have no `isVisible` predicate (`Catalog`, `Categories`, `Employees`, `Roles & access`, `Stores`, and `Registers`), and several corresponding pages currently render a read/view experience before their management controls are permission-gated.

This is not evidence that a Cashier can mutate protected records—the actions/RPCs/RLS still enforce permissions—but it does not meet the desired workspace-separation standard. Phase 1 must add explicit Back Office workspace and direct-route access policy, then test Cashier deep links. It must not rely on menu hiding alone.

**POS IMPACT:**

No POS behavior changed.

Audit findings:

- POS is already a separate full-screen operational route and is not wrapped in the Back Office sidebar layout.
- `/pos` verifies `sales.create` server-side before rendering.
- `PosShiftGate` prevents product search, scan/item addition, cart changes, payment, and checkout until an active register shift exists.
- POS passes only active/assigned stores and registers into the terminal; checkout independently verifies `sales.create`, assigned-store scope, validation schemas and the authoritative checkout RPC.
- Device-aware actions send the registered POS device credential where applicable; revocation/invalid device is rejected by the database path.
- Current POS header already includes store/register/employee/shift context, offline queue status and shift closing. It does not yet implement the target drawer-oriented POS navigation, customer shortcut, or cashier-safe POS settings menu as a unified pattern.
- Current POS links back to `/back-office`, `/back-office/shifts` and `/back-office/time-clock`; this is a navigation/entry concern for later phases, not a reason to rebuild checkout or shift logic.

**BACK OFFICE IMPACT:**

No Back Office behavior changed.

Audit findings:

- The desktop sidebar is sticky and current-page state is accessible.
- Navigation groups already collapse/expand and filter several feature/permission-based destinations.
- Current groups broadly match the target: Dashboard, Reports, Sales, Catalog, Inventory, Customers, Team, Management and Settings.
- Required later refinements: remove the normal `Open POS` sidebar item, split operational Shift controls from Back Office shift history/reporting, make every Back Office destination permission-aware, and decide whether Feature Settings is a labeled Business Profile section or a distinct Settings destination.
- Kitchen remains a deliberately separate authorized operational display and should be retained.

**OFFLINE IMPACT:**

No offline behavior changed.

Audit findings:

- The browser offline store uses IndexedDB with a scoped checkout queue, catalog/runtime snapshots and device identity storage.
- Queued transactions preserve the idempotency key, organization/user scope, device information, shift/store/register snapshot, item snapshot and local receipt reference.
- Offline settlement is intentionally restricted to one eligible cash payment with no loyalty redemption or open ticket.
- Reconnect uses the same canonical checkout implementation, preserving exactly-once behavior through the checkout key; server-observed outcomes are recorded as `SYNCED` or `CONFLICT` events.
- Offline/device/shift behavior is a high-regression-risk area and is explicitly out of scope for Phase 1 refactoring.

**DEVICE IMPACT:**

No device behavior changed.

- Device registration, rebinding and revocation require `devices.manage` at the server-action boundary and use device-specific RPCs.
- POS device identity is part of checkout/shift validation where device management is enabled.
- Device changes revalidate POS, device and security views.

**AUDIT LOG IMPACT:**

No audit behavior changed.

Existing auditable/security-sensitive flows include approvals, PIN/approval activity, refunds, cash movements, inventory movements, device management and offline sync outcomes. Subsequent phases must preserve these existing audit-producing RPC paths rather than replace them with frontend-only state.

**TYPECHECK:**

Passed — `npm run typecheck`.

**LINT:**

Passed with one known pre-existing warning — the catalog page uses a plain `<img>` element and triggers `@next/next/no-img-element`. There are no lint errors.

**BUILD:**

Passed — Next.js production build completed all 45 routes.

**AUTOMATED TESTS:**

- `npx supabase db advisors --local --type all --level warn` — passed; no issues found.
- `npx supabase test db --local` — passed: 37 files, 851 pgTAP tests.
- The successful database suite includes RLS, multi-tenant readiness, checkout RPC arguments, shifts/time clock, payment configuration, inventory integrity, devices, offline sync, receipts/refunds, security approvals, Smart Menu and configuration tests.

**MANUAL QUALITY ASSESSMENT CHECKLIST:**

Phase 0 is an audit; no manual workflow was changed. The following tests are required when the later relevant phase is implemented:

- [ ] Sign in as Owner, Admin, Manager, Inventory Staff and Cashier.
- [ ] Attempt each Back Office deep link as Cashier, including Catalog, Categories, Employees, Roles, Stores and Registers; confirm the Phase 1 server route policy denies or redirects appropriately.
- [ ] Confirm a Cashier can enter `/pos` only with `sales.create`, and cannot enter an operational catalog/cart/payment state with no open shift.
- [ ] Confirm Manager data stays within assigned store scope.
- [ ] Confirm an altered organization, store, register, shift or device identifier is rejected by every sensitive command.
- [ ] Run an online-to-offline-to-reconnect sale and verify one final receipt, payment, sale and inventory movement.

**KNOWN RISKS:**

1. **Workspace-access gap:** broad Back Office layout/nav reachability for users who are authenticated employees but lack management permissions. This is the first Phase 1 issue to address; backend mutation protections remain intact.
2. **Shift UI duplication of responsibility:** Back Office currently contains operational shift/cash controls in addition to POS controls. Relocating UI must not alter the cash/shift RPCs or historical views.
3. **Offline/device regression risk:** navigation or workspace refactors must not alter device headers, queue scope, offline snapshots or idempotency keys.
4. **Sensitive database boundary risk:** new direct-route guards must complement—not replace—RLS/RPC authorization.
5. **Existing lint baseline:** catalog image optimization warning remains a low-severity quality item, not a blocking Phase 0 failure.

**KNOWN LIMITATIONS:**

- This audit did not conduct signed-in, role-by-role browser testing because Phase 0 is non-destructive and no QA role session was supplied.
- Static code and local database inspection cannot prove every production environment variable, printer, camera/scanner, device browser or network failure case.
- A local schema check confirms RLS is enabled; Phase 7 will still need deliberate adversarial authorization tests against sensitive commands.

**REGRESSION AREAS:**

- Checkout and payment atomicity/idempotency.
- Refund, stock and receipt relationships.
- Shift/cash calculations and blind close behavior.
- Device registration/revocation and POS device headers.
- Offline queue persistence, retry and conflict outcomes.
- Organization and assigned-store scope.
- Feature-disabled data preservation.

**RECOMMENDATION:**

Approve Phase 0. The safest Phase 1 is a **targeted workspace-access and route-policy pass only**:

1. Define explicit Back Office workspace eligibility from permissions, while retaining legitimate Cashier time-clock/POS access.
2. Enforce that policy server-side on Back Office routes, not only in navigation.
3. Make every sidebar item use the same permission-aware policy.
4. Replace the normal `Open POS` sidebar placement with a separate workspace entry without changing `/pos` or checkout.
5. Keep `/back-office/shifts` as history/reporting during the transition; do not remove any shift or cash command.
6. Add role/deep-link tests before declaring Phase 1 complete.

**STOP:**

Phase 0 is complete. Do **not** begin Phase 1 until explicit approval is provided.
