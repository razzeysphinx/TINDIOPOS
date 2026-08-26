# TINDIO POS — Page Capability Audit

**Planning cycle:** usability, management, operations, portability, loyalty, product identification, Smart Menu, navigation, and consistency  
**Audit phase:** 0 — no application behavior or database schema changed  
**Audited branch:** `refactor/separate-frontend-backend`  
**Audit date:** 2026-08-26

## Executive summary

TINDIO is a working multi-tenant POS with an established security and business-logic boundary:

```text
UI / pages → Server Actions → services / data → Supabase RPC and RLS → PostgreSQL
```

The next cycle should extend this architecture. It must not add parallel product, receipt, navigation, loyalty, or menu systems.

The audit found that:

- The Back Office has **24 management/history routes**, plus POS, kitchen, customer-display, onboarding, organization-paused, auth, and public support routes.
- Management pages already have useful create actions, but many expose them as always-visible inline cards. There is **no shared `Dialog` or `Sheet` primitive in `src/components/ui`** and no current feature uses one.
- Product catalog CSV import/export already exists and is the only current page-level bulk import flow. Reports already export seven scoped CSV datasets.
- All 85 current `public` tables have RLS enabled. Some tables intentionally have no table policy because they are reached only through guarded RPCs.
- There are 257 application functions in `public` and `private`; significant financial, inventory, shift, approval, device, and checkout logic already lives in PostgreSQL RPCs.
- Product and variant SKU/barcode values are already format-validated and unique within an organization. A cross-table identifier guard prevents one active identifier from ambiguously resolving to different saleable items.
- Current customer loyalty is points-ledger based. `customers.loyalty_card_code` exists, but there is no separate QR loyalty-card entity yet.
- There is no Smart Menu data model or public menu route yet. It must read from the existing catalog and store availability records.

## Audit conventions

| Mark | Meaning |
|---|---|
| `Built` | Supported by the present UI and authoritative server/RPC path. |
| `Partial` | Some capability exists, but is incomplete or not standardized. |
| `Later` | Appropriate for a later planning phase; not implemented in Phase 0. |
| `No` | Intentionally unavailable. |
| `Controlled` | A safe workflow exists, but this is not ordinary CRUD. |

Role names below are shorthand for the actual permission checks. Authorization remains database-backed through role permissions, RLS, and RPC validation.

---

## 1. Full route inventory

### Public, authentication, and access-flow routes

| Route | Page | Intended audience | Current purpose |
|---|---|---|---|
| `/` | TINDIO landing | Public | Marketing entry point and links to sign-in/setup. Copy still references the old cash-checkout milestone and needs a Phase 9 content review. |
| `/login` | Sign in | Unauthenticated users | Sign-in, confirmed-account status, safe redirect support. |
| `/signup` | Create account | Unauthenticated users | Account creation and confirmation flow. |
| `/auth/error` | Auth error | Unauthenticated users | Confirmation/callback failure recovery. |
| `/auth/callback` | Auth callback route | Supabase Auth callback | Exchanges the authentication response and redirects safely. |
| `/join` | Employee invitation | Invite recipient | Secure invitation review and acceptance; exact-email and token protections apply. |
| `/onboarding` | Business setup | Verified user without a selected business, or owner adding a business | Creates an organization, first store, register, and owner membership atomically. Also accepts pending invitations. |
| `/organization-paused` | Organization lifecycle | Member of suspended/archived organization | Restricted lifecycle, recovery, export, organization-switching, and sign-out access. |
| `/offline` | Offline fallback | Browser user | Offline recovery guidance; the already-open POS may queue qualified cash sales. |

### Operational and customer-facing routes

| Route | Page | Intended audience | Current purpose |
|---|---|---|---|
| `/pos` | POS terminal | `sales.create`; feature and store assignments further constrain use | Catalog search, barcode/SKU lookup, cart, ticketing, payment, checkout, offline queue, time-clock/shift state. |
| `/kitchen` | Kitchen display | `kitchen.view` or `kitchen.manage`, Kitchen feature enabled | Real-time kitchen orders and controlled status/priority/routing changes. |
| `/customer-display/[token]` | Customer display | Holder of hashed display token | Pairable real-time customer display; not a general Back Office page. |
| `/customer-display/[token]/receipt/[saleId]` | Digital receipt | Holder of display token plus valid receipt reference | Read-only receipt projection through a restricted RPC. |

### Back Office routes

| Route | Page | Primary current permission / feature gate | Current role in the product |
|---|---|---|---|
| `/back-office` | Dashboard | `dashboard.view` | Dashboard snapshot with date/store filters. |
| `/back-office/reports` | Reports | `reports.view` | Reporting snapshot, date/store filters, CSV export links. |
| `/back-office/catalog` | Catalog | `products.manage`; cost additionally needs `products.view_cost` | Products, variants, per-store availability, components, and catalog CSV tools. |
| `/back-office/categories` | Categories | `products.manage` for write | Category configuration. |
| `/back-office/customers` | Customers & loyalty | `customers.manage`; loyalty configuration also `settings.manage` | Customer list, customer creation, segments, and points-program settings. |
| `/back-office/customers/[customerId]` | Customer profile | `customers.manage` | Customer edit/archive, segments, history, and loyalty ledger/adjustments. |
| `/back-office/receipts` | Receipts | `receipts.view` | Completed receipt history with cursor pagination. |
| `/back-office/receipts/[receiptId]` | Receipt detail | `receipts.view`; action-specific permissions | Immutable transaction snapshot, print/reprint, refund, exchange, and delivery requests. |
| `/back-office/shifts` | Register shifts | Shift/cash permissions or settings access; Shifts feature | Open/close shifts, cash movement, cash-close setting, and history. |
| `/back-office/time-clock` | Time clock | Time Clock feature | Employee clock-in/out; separate from shift cash control. |
| `/back-office/inventory` | Inventory | Inventory feature; `inventory.manage` for controlled writes | Stock projection, opening/adjustments, counts, POs, transfers, policies, reasons, production. |
| `/back-office/replenishment` | Replenishment | Inventory feature and supply-chain permission gate | Warehouses, reorder rules, stock requests, dispatch, receiving, and inbound POs. |
| `/back-office/stores` | Stores | `stores.manage` | Store list and create flow. |
| `/back-office/registers` | Registers | `registers.manage` | Register list/create and customer-display provisioning. |
| `/back-office/devices` | POS devices | `devices.manage` | Device registration, register reassignment, and revocation. |
| `/back-office/offline-sync` | Offline sync center | `devices.manage` | Read-only server-observed offline sync history. |
| `/back-office/employees` | Employees | `employees.manage` for invitations | Employee list, invitation/revocation, and PIN setup. |
| `/back-office/roles` | Roles & permissions | `roles.manage` for creation | Role/permission list and custom-role creation. |
| `/back-office/security` | Security & approvals | `approvals.manage`, `audit.view`, or approval request permissions | Approval rules, approval requests, and append-only audit review. |
| `/back-office/payment-methods` | Payment methods | `settings.manage` | Payment method configuration, store availability, and offline policy. |
| `/back-office/receipt-settings` | Receipt settings | `settings.manage` | Configuration captured by subsequently issued receipt snapshots. |
| `/back-office/business-profile` | Business profile & features | `settings.manage`; lifecycle/recovery permission gates | Business feature settings, lifecycle, export/recovery controls. |
| `/back-office/advanced-sales` | Advanced sales | `products.manage`; feature gates | Discounts, taxes, dining options, ticket templates, and modifiers. |

### Server routes relevant to later phases

| Route | Current contract | Later-phase relevance |
|---|---|---|
| `/api/catalog/export` | Scoped catalog CSV export | Reuse as the catalog export reference implementation. |
| `/api/reports/export` | Scoped exports for sales, inventory, employees, payments, registers, customers, and security | Reuse authorization/filter/export patterns; do not make reports editable. |
| `/api/organization-export` | Owner-authorized organization data export | Keep separate from ordinary operational CSV exports. |
| `/api/pos/catalog` | POS catalog search/projection | Preserve when adding generated identifiers or Smart Menu metadata. |
| `/api/pos/customers` | POS customer search | Reuse customer source of truth for loyalty selection; do not add a duplicate customer lookup. |
| `/api/pos/modifiers` | POS modifier lookup | Smart Menu must reuse modifier data rather than copy modifier definitions. |
| `/api/pos/checkout` and `/api/pos/offline-checkout` | Checkout transports sharing canonical checkout service | Out of scope for ordinary CRUD refactors. |
| `/api/pos/customer-display` and `/api/pos/device` | Display/device operations | Preserve token and device boundaries. |

---

## 2. CRUD capability matrix

This records current behavior and the correct future classification. “Delete” means a physical delete; TINDIO should normally use archive/deactivate for business configuration.

| Page / entity | Create | Read | Update | Archive / delete | Search / filter / pagination | Correct future direction |
|---|---:|---:|---:|---:|---|---|
| Dashboard | No | Built | No | No | Date/store filter | Remain read-only. |
| Reports | No | Built | No | No | Date/store filter | Remain read/export-only. |
| Products & variants | Built | Built | Partial — availability and extensions only | Built archive/restore | POS search only; no Back Office search/filter/pagination | Add controlled edit workflow, list search/filter/pagination, archive safeguards, and generated identifiers. Product editor is complex: use a large sheet or dedicated editor, not a tiny dialog. |
| Categories | Built | Built | No | Built archive/restore | No | Add edit and searchable/sortable management list. Modal is appropriate. |
| Customers | Built | Built | Built on detail route | Built archive/restore | POS search; no Back Office search/filter/pagination | Add list search/filter/pagination and modal create; retain detailed profile route for history and sensitive loyalty changes. |
| Customer segments | Built | Partial | No | No | No | Add edit/archive only if existing segment membership/history rules are preserved. Modal is appropriate. |
| Loyalty program | No separate creation | Built | Built | No | No | Configuration only. Retain ledger immutability. QR loyalty cards are a separate later entity, not a customer-profile rewrite. |
| Loyalty ledger | Controlled manual adjustment | Built | No | No | Customer-scoped history | Append-only. Manual adjustment must keep reason and audit record. |
| Payment methods | Built | Built | Built | Partial — disable/store-disable rather than delete | Sort order only | Add presets-first grouping and modal custom creation. Never physically delete methods referenced by payments. |
| Discounts / taxes / dining options | Built | Partial — manager currently does not display full editable lists | No | No | No | Build standard config lists, edit/deactivate behavior, preset grouping where appropriate. |
| Ticket templates / modifiers | Built | Partial | No | No | No | Add edit/deactivate and proper list views. Do not alter live/open-ticket history. |
| Stores | Built | Built | No | No | No | Add edit/active-state workflow; do not delete a store with historical sales, shifts, inventory, or registers. Modal is appropriate. |
| Registers | Built | Built | No | No | No | Add edit/active-state workflow. Protect historical receipt/shift references. Modal is appropriate. |
| Employees | Invitation-based creation | Built | Partial — PIN only | Invitation revoke only | No | Do not bulk-create authenticated accounts. Add carefully scoped employee profile/assignment changes only through invitation and role/store assignment controls. |
| Roles | Built custom roles | Built | No | No | No | Add edit for custom roles only; system roles must remain controlled. Any permission change needs server/RPC authorization. |
| POS devices | Built/register | Built | Built reassign register | Built revoke | No | Controlled security workflow. Use modal/dialog confirmation; never restore a revoked credential implicitly. |
| Receipt settings | No separate creation | Built | Built | No | No | Configuration page should remain a dedicated editor because it affects future immutable receipt snapshots. |
| Business profile / features | No separate creation | Built | Built | Controlled lifecycle only | No | Keep a dedicated settings page. Lifecycle must remain non-destructive and export-governed. |
| Shifts / cash movements | Controlled open/pay-in/pay-out/close | Built | No historical edit | No | Recent/history list | Financial history is immutable. Use corrective transactions, not CRUD. |
| Time-clock entries | Controlled clock in/out | Built current entry | No historical edit | No | No | Attendance workflow; do not turn into generic CRUD without a separately approved correction policy. |
| Inventory levels | Derived projection | Built | No direct write | No | No | Read-only projection. Use approved inventory workflows. |
| Inventory movements | Controlled operations | Built | No | No | Recent 30 only | Append-only ledger. No CSV “edit” or deletion. |
| Suppliers | Built | Built in workflows | Partial — lead time only | No | No | Add standard supplier edit/deactivate and searchable list. Modal is appropriate. |
| Purchase orders | Built | Built active/inbound scopes | Controlled receipt only | No | Status-based views | Preserve transaction/state machine; no direct delete/edit after order creation. |
| Inventory counts / stock transfers / stock requests | Built controlled workflows | Built scoped views | Controlled transitions only | No | Status/workflow views | Preserve state-machine RPCs and movement integrity. |
| Replenishment rules / warehouses / adjustment reasons / inventory policy | Built | Built | Partial — policy, lead time, upsert rule | No | No | Add config-list editing/deactivation only where the underlying state machine permits it. |
| Receipts / completed sales / payments / refunds | Refund and exchange are corrective actions only | Built | No | No | Receipts have cursor pagination only | Immutable audit record. Add search/filter/export/reprint, not CRUD. |
| Kitchen orders | Derived by completed sale | Built | Controlled status/priority/routing | No | Current workspace | Do not offer delete or general edit. |
| Offline sync events | No | Built | No | No | Latest 200 only | Immutable diagnostic/audit data; export/filter may be useful. |
| Approval rules | No separate page creation | Built | Built | No | No | Keep authorization logic in RPCs. Add consistent rule presentation only. |
| Approval requests / audit logs | Controlled request/approval | Built | No | No | Recent list only | Immutable security evidence; export/filter only for authorized roles. |

---

## 3. CSV necessity matrix

| Domain / page | Current state | Import recommendation | Export recommendation | Safety notes |
|---|---|---|---|---|
| Products & variants | **Built:** template, client preview, validation, transactional RPC import, catalog export | Yes — retain and improve only if needed | Yes — built | Existing flow is the reference: exact headers, preview, row errors, duplicate detection, and atomic server validation. |
| Categories | No page-level CSV | Optional later, only if merchants commonly create many categories | Yes, bundled with catalog or separate small export | Small lists are normally faster in a modal; do not prioritize import. |
| Customers | No page-level CSV; reports can export customers | Yes — useful for CRM migration | Yes — dedicated page export may be useful | Validate duplicate/merge policy before write. Never silently use an email/phone to overwrite a person. |
| Customer segments | No | Optional | Optional | Import only after customer identity matching rules are explicitly approved. |
| Suppliers | No | Yes — useful | Yes | Safe configuration data, but validate duplicate name/contact policy. |
| Product price lists | No dedicated flow | Yes — later, controlled bulk update | Yes | Must use a separate preview and effective scope; do not treat it as catalog creation. |
| Opening inventory / stock counts | Forms only | Yes — high value | Yes | Must create controlled count/opening-stock operations, not direct `inventory_levels` writes. Require store scope, preview, reasons, and audit entry. |
| Stock adjustments | Forms only | Limited, later | Yes — movement export | Import must create accountable adjustment transactions per row and require reason/approval as configured. It must never edit the ledger. |
| Purchase-order line items | UI workflows only | Yes — useful for large supplier orders | Yes | Import only draft/order lines; never bulk-edit received historical quantities. |
| Employees | Reports export exists | No generic employee-account import | Yes — built in reports | Auth accounts, invitations, role grants, and store grants must remain verified workflows. A future “invite campaign” import is not ordinary employee CSV CRUD. |
| Stores / registers / roles / payment methods | No | Optional, low priority | Optional | Small and security-sensitive configuration sets; prioritize modal workflows over CSV. |
| Discounts, taxes, dining options, modifiers | No | Optional, low priority | Optional | Presets-first UI is more valuable than import for normal merchants. |
| Sales, receipts, refunds, payments | **Built:** reports exports | No | Yes — built | Never import historical financial records through normal CSV. |
| Shifts, cash movements, inventory movements | Shift views / reporting data only | No | Yes — export-only | Immutable/accountability records. |
| Audit logs, approval requests, offline sync | Read-only pages | No | Yes — authorized export only | Export must stay tenant- and permission-scoped and exclude secrets/tokens. |
| Organization export | **Built:** protected export flow | No | Yes — built | Retain as owner-governed portability/recovery operation, not a replacement for page CSV. |

### Import standard for every later CSV flow

```text
Download template → upload → parse/validate → preview and row errors → explicit confirmation → one atomic server/RPC commit → audit summary
```

No later CSV flow may partially mutate data without an explicit, auditable policy. Product imports already provide the strongest current implementation reference.

---

## 4. Modal, sheet, and dedicated-page recommendations

No shared dialog/sheet primitive currently exists. Establish one accessible shared pattern before converting individual forms.

| Page / entity | Recommended create/edit surface | Reason |
|---|---|---|
| Categories | Small modal | Short configuration record. |
| Payment methods | Modal | Custom method creation is compact; existing method card can move to edit modal. |
| Stores | Modal | Short configuration record; archive/deactivate needs a guarded confirmation. |
| Registers | Modal | Short configuration record linked to a store. |
| Custom roles | Large modal or sheet | Permission matrix needs more space and clear review. |
| Employee invitation | Modal | A focused invitation workflow is appropriate; preserve exact-email and role/store checks. |
| Customer creation | Modal | Fast CRM entry at Back Office; customer detail remains a dedicated page. |
| Customer profile | Dedicated detail page | Purchase history, segments, ledger, and sensitive adjustments need persistent context. |
| Products / variants / composite recipes | Large sheet or dedicated editor | Current product form is complex: variants, identifiers, stores, inventory, weighted/variable price, components, and CSV must not be squeezed into a small modal. |
| Product components and store configuration | Modal or side sheet | Scoped supporting configuration, but preserve existing product context. |
| Discounts, taxes, dining options, modifiers, ticket templates | Modal | Each is a focused configuration record; show presets/list first. |
| Suppliers | Modal | Compact master-data record. |
| Purchase orders, counts, transfers, stock requests | Dedicated workflow / large sheet | These are multi-line, stateful, inventory-sensitive operations. |
| Shift opening / close / cash movement | Modal or dedicated POS operational panel | Financial confirmations need focus, validation, and receipt-like confirmation. |
| Device binding/reassignment/revocation | Modal with confirmation | Credential and register-binding security. |
| Receipt settings / business profile / lifecycle / recovery | Dedicated pages | Broad settings and high-impact lifecycle controls do not fit a small modal. |
| Refund / exchange / approval | Existing focused dialogs/forms | Preserve current special authorization and revalidation behavior. |

---

## 5. Presets-first UX candidates

| Page | Existing system evidence | Recommended presentation |
|---|---|---|
| Payment methods | Organization bootstrap already seeds default payment methods; current manager allows custom methods and configuration | Show **TINDIO presets** first, then **Custom methods**. Keep preset records/configuration in the existing payment tables; do not duplicate them. |
| Dining options | Existing `dining_options` entity and default semantics | Offer Dine In, Takeout, and Delivery as optional presets, then custom options. Decide whether seed records or a preset installer is preferable only after reviewing existing bootstrap behavior. |
| Taxes | Existing tax-rate entity and default/inclusive flags | Offer common regional templates only when localization is planned; otherwise retain custom creation to avoid tax-law assumptions. |
| Discounts | Existing percentage/fixed entities | Offer optional common templates, clearly labeled as editable configuration—not legal/eligibility rules. |
| Receipt settings | Existing per-organization setting record | Offer layout/text presets as form-fill choices, not duplicate receipt-setting records. |
| Ticket templates | Existing ticket-template records | Offer named operating templates where a business type supports them; custom templates remain separate. |
| Roles | Existing system roles plus custom roles | Present system roles first and immutable where required; custom role creation remains separate. |
| Inventory adjustment reasons | Existing reason configuration | Offer recommended non-destructive reason codes, then custom codes. |
| Business features | Existing business-type feature recommendations | Keep recommendation logic as a guide; do not create duplicate feature rows. |

## 6. Records that must remain immutable or controlled

The following must not receive direct generic edit/delete UI:

- Completed sales, sale items, payments, receipts, and receipt layout snapshots.
- Refunds, refund lines, refund payments, and exchange links.
- Inventory movements, stock transfer receipts, goods receipts, production runs, and projected inventory levels.
- Closed shift records, recorded cash counts, and historical cash movements.
- Approval requests, audit logs, offline synchronization events, and device credential history.
- Kitchen orders derived from completed sales.
- Loyalty ledger entries. Corrections must be a new, reasoned adjustment/reversal, never a rewritten balance.

Safe alternatives are: view, search, filter, pagination, export, reprint, refund, exchange, reverse, archive/deactivate a configuration record, or create a correcting transaction.

---

## 7. Permission and security risks

1. **RLS and RPC boundaries are authoritative.** Every current public table has RLS enabled. New tables must also enable RLS, and new UI visibility must never be treated as authorization.
2. **RPC-only tables are intentional.** Several tables have zero direct RLS policies because guarded RPCs own the workflow. Do not add broad browser table access merely to simplify a UI.
3. **Avoid broad `products.manage` expansion.** Advanced sales configuration currently shares that permission. A more granular permission model may be worthwhile later, but must be an explicit migration with role-default review—not an incidental UI change.
4. **CSV imports need atomic, tenant-scoped server commits.** Client-side parsing is useful for preview only. Duplicate resolution and persistence must occur in server/RPC code, with organization/store checks and audit coverage.
5. **Employee import is not generic CRM import.** Creating or altering an employee can affect Auth identities, roles, store assignments, and RLS. Preserve invitation acceptance and token controls.
6. **Shift gate must remain server-enforced.** A full-screen POS must not replace `require_active_pos_shift` / active-shift RPC checks with a client-only lock.
7. **Identifiers must use the existing uniqueness guard.** Generated SKU/barcode values must call a canonical server/RPC generator or use a collision-safe constrained insertion strategy. Do not generate codes only in the browser.
8. **QR loyalty must not carry mutable truth.** QR payloads must never expose editable stamp count or reward eligibility. Use an opaque card identifier plus a server-verifiable signed/hashed token, and record sensitive stamp adjustments.
9. **Smart Menu is a public-read risk.** It must not grant anonymous access to the full product/catalog tables. Use a narrow public projection/RPC or safe public route that exposes only enabled menu items and allowed product fields.
10. **Archiving must preserve references.** Product, category, store, register, payment method, role, and supplier changes need referenced-record checks and a clear deactivate/archive policy rather than destructive deletion.
11. **Financial history requires corrective actions.** Refunds, cash movements, and stock adjustments already use approvals/audit patterns. New bulk operations must preserve that model.
12. **No service-role key in the browser.** The existing JWT/RLS model remains mandatory.

---

## 8. Likely later database changes

These are planning findings only. Every approved schema change must be additive, backward-compatible, tested, and recorded in a new migration. Migration history must not be rewritten.

| Later phase | Existing foundation | Likely additive work | Not needed / prohibited |
|---|---|---|---|
| Global CRUD standard | Existing entity tables, update timestamps, RLS, actions/services | New guarded update/archive RPCs only where functionality is genuinely missing; audit event additions for sensitive changes | No replacement `*_v2` tables; no direct financial-history update/delete. |
| CSV framework | Catalog import RPC, catalog/report exports, audit logs | Possibly durable `import_batches` / row-result storage if import history and downloadable error reports are required; scoped import/export RPCs and indexes | No direct bulk write to projections, sales, receipts, or audit tables. |
| Navigation | Existing Back Office layout and permission-aware navigation | None expected | No duplicate navigation system or permission bypass. |
| Full-screen POS | Existing time clock, active-shift gate, register/device state, POS workspace | None expected unless a saved operational-mode preference is explicitly needed | No weakening of active-shift/device/permission checks. |
| SKU & barcode generation | `products.sku/barcode`, `product_variants.sku/barcode`, unique indexes, cross-table identifier validation | Canonical server/RPC generator; optional label-print layout/preferences if persistence is needed | No duplicate identifier table; no reuse of archived identifiers without an approved policy. |
| QR loyalty cards | `customers.loyalty_card_code`, loyalty program, immutable points ledger, audit logs | `loyalty_cards` with organization scope, optional customer link, card code, status, signed-token/hash fields, timestamps; append-only stamp/reward audit or carefully scoped extension of audit logs; new RPCs/permissions | Do not store stamp count/reward authority in the QR itself; do not overwrite loyalty ledger history. |
| Smart Menu V1 | Products, variants, categories, modifiers, product-store settings, images, organization features | Menu settings plus ordering/visibility metadata, likely per organization/store; secure public access token or slug; read-only public projection/RPC; supporting indexes | No separate menu product master or copied product price/name/source of truth. |
| Presets-first UX | Seeded payment methods, business feature recommendations, system roles, config entities | Usually none. Add a `preset_key`/source marker only if current records cannot safely distinguish preset from custom. | Do not clone preset rows every time a page opens. |
| UI consistency pass | Shared `PageHeader`, button/card/input primitives | Shared dialog/sheet, table/list, empty/loading/error, pagination, and action-menu primitives if adopted | No behavior-changing schema work by default. |

### Schema facts relevant to product identification

- Products and variants already contain nullable `sku` and `barcode` fields.
- Both are organization-scoped unique when present.
- Existing database constraints normalize/validate SKU and barcode format.
- Existing database logic checks identifiers across products and variants so one lookup cannot resolve ambiguously.
- An archived product is not a safe signal to recycle its historical identifier. The current unique protection intentionally continues to protect identifier history.

### Schema facts relevant to loyalty and Smart Menu

- Customer loyalty currently has `loyalty_programs`, `loyalty_transactions`, and `customers.loyalty_card_code`; it does **not** have a physical/digital-card lifecycle table.
- Product catalog already has category, variant, modifier, image URL, price, availability, and store configuration foundations required by Smart Menu.
- There is no Smart Menu table, feature key, permission code, or public route today.

---

## 9. Recommended implementation order based on the repository

The requested order is sound with two repository-specific prerequisites: establish accessible dialog/sheet/list primitives at the beginning of Phase 1, and preserve the existing server/RPC authority for every write.

1. **Phase 0 — Page Capability Audit** — complete with this document.
2. **Phase 1 — Global CRUD & Management UX Standard** — first create shared modal/sheet/list conventions, then improve the low-risk configuration pages: categories, payment methods, stores, registers, customer creation, roles, suppliers, and advanced-sales configuration. Products require a larger editor; financial/history pages are excluded.
3. **Phase 2 — CSV Import / Export Framework** — extend the existing catalog import/export pattern. Prioritize customers, suppliers, price lists, inventory counts, stock adjustments, and purchase-order lines. Keep sales/receipts/ledger records export-only.
4. **Phase 3 — Navigation & Information Architecture** — replace the current flat `BackOfficeNavigation` list with permission-aware collapsible groups and retain mobile usability. This is purely a presentation change and must preserve all current route gating.
5. **Phase 8 — Presets-First Configuration UX** — layer preset grouping and `+` create affordances on the standardized Phase 1 surfaces. Payment methods are the first candidate because default methods are already seeded.
6. **Phase 4 — Full-Screen POS Operational Mode** — introduce a POS-specific layout from time-in/open-shift through selling. Preserve the current server-enforced shift and device gates and keep Back Office navigation out of the operational layout.
7. **Phase 5 — Automatic SKU & Barcode Generation** — build on the improved product editor and existing identifier constraints; then add label printing.
8. **Phase 6 — Lightweight QR Loyalty Card** — extend, rather than replace, the existing customer/loyalty ledger architecture. Define QR/security/offline policy before UI construction.
9. **Phase 7 — Smart Menu V1** — build a read-only customer view sourced from the existing catalog and store availability. Implement a narrow secure public projection before exposing a route.
10. **Phase 9 — Global UI Consistency & Quality Pass** — review every route for visual hierarchy, empty/loading/error states, keyboard/touch behavior, responsive layout, and permission states. Also update stale landing-page milestone copy.

## Phase 0 completion criteria

- [x] Major Back Office, POS, customer-facing, access-flow, and supporting API routes are inventoried.
- [x] CRUD behavior is classified, with controlled/immutable records separated from ordinary management data.
- [x] CSV import/export necessity is classified.
- [x] Modal/sheet versus dedicated-page recommendations are identified.
- [x] Presets-first candidates are identified without proposing duplicate records.
- [x] RLS, permissions, RPC, identifier, audit, and public-read risks are recorded.
- [x] Later schema work is identified at planning level only.
- [x] An evidence-based implementation order is recommended.

**Stop point:** Phase 0 is complete. No Phase 1 code or migration work should begin until explicit approval is given.
