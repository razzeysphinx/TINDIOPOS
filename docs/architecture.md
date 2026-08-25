# TINDIO architecture

## Scope

This document is the architecture contract through Phase 7. Phase 1 implements identity, organization setup, stores, registers, employees, RBAC, and their database security boundaries. Phase 2 implements the catalogue and basic inventory model. Phase 3 implements the in-memory POS cart. Phase 4 implements checkout and financial records, Phase 5 adds receipts and refunds, Phase 6 adds accountable register shifts and cash control, and Phase 7 adds customer CRM and loyalty.

## Product identity and design system

- **Name:** TINDIO
- **Tagline:** Sell simple. Grow smarter.
- **Design direction:** operational, compact, touch-friendly, and readable. Teal is for primary actions and success; warm neutral surfaces support long operating sessions.
- **Theme:** design tokens define light and dark palettes. A user-facing persisted theme control remains a later interface enhancement.

The app uses Tailwind CSS and shadcn/ui primitives. New controls should be composed from `src/components/ui`, not copied into feature folders. Brand components belong in `src/components/brand`.

## Application structure

```text
src/
  app/                  # Next.js App Router routes and route-group layouts
  components/
    brand/              # TINDIO product identity components
    ui/                 # shadcn/ui primitives
  features/             # Domain modules, added only when a phase needs them
  lib/                  # Cross-cutting helpers and future Supabase clients
```

Planned route groups keep experiences distinct while sharing a single deployment and Supabase project:

```text
(auth)                         sign-in and recovery
(back-office)                  owner and manager tools
(pos)                          cashier terminal
customer-display/[registerId]  customer-facing display
kitchen/[storeId]              kitchen display
```

## Authentication and authorization

Phase 1 uses Supabase Auth with cookie-based SSR clients. The browser receives only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Service-role keys and database connection credentials are never exposed or required by the application.

An authenticated user maps to a profile and employee record. Employee roles and store assignments define authorization; editable `user_metadata` is never used for permissions. UI visibility is a usability aid only—database policies and server-side permission checks enforce access.

Each application table exposed through the Supabase Data API will have RLS enabled. RLS is not the same as object privileges: migrations must explicitly grant the minimum `SELECT`, `INSERT`, `UPDATE`, or `DELETE` privileges needed by `authenticated`, and revoke everything else. New tables are manually opted in to API exposure only when the application needs them.

The Phase 4 checkout routine is a privileged database boundary, not an arbitrary public RPC. It uses a fixed `search_path`, validates the authenticated actor and scoped `sales.create` permission in the database, revokes `EXECUTE` from `PUBLIC`, and grants only the authenticated caller role. Its `SECURITY DEFINER` helper stays in the non-exposed `private` schema, contains no dynamic SQL from request values, and reconstructs prices, totals, receipts, and stock movements from trusted rows.

## Multi-store and data integrity model

Every business record belongs to an organization. Stores belong to an organization, registers to stores, and employees gain access through store assignments. This supports a single-store launch without a later tenancy rewrite.

Supabase Postgres is authoritative for money, sale status, inventory, permissions, loyalty, and shifts. Browser state is disposable. Money columns use integer minor units; quantities use an explicitly chosen integer or numeric unit type. Completed sales and receipts are immutable records. Inventory changes are ledger entries, never silent quantity rewrites.

## ERD plan: Phases 0–4

All primary keys use UUIDs. Tenant-owned tables carry `organization_id`, have a foreign key to `organizations`, and receive an index beginning with `organization_id`. Foreign keys used in RLS predicates or report joins receive supporting indexes.

```text
auth.users
    1 ── 1 profiles
    1 ── * employees ── * employee_stores * ── 1 stores

organizations
    1 ── * stores ── * registers
    1 ── * roles ── * role_permissions * ── 1 permissions
    1 ── * categories
    1 ── * products ── * product_variants
    1 ── * sales ── * sale_items

stores + saleable product/variant
    1 ── 1 inventory_levels
    1 ── * inventory_movements

registers
    1 ── * sales ── * payments
sales
    1 ── 1 receipts
```

### Phase 0

No tables or migrations. This project only defines the environment contract and database architecture.

### Phase 1: business setup

| Table | Purpose and key relationships |
| --- | --- |
| `organizations` | Tenant root. `id`, name, default currency code, timezone, timestamps. |
| `profiles` | One row per `auth.users` identity; primary key is `auth.users.id`. Contains non-authoritative display identity only. |
| `stores` | Belongs to one organization; unique human-readable store code per organization. |
| `registers` | Belongs to one store; unique register name/code per store. |
| `employees` | Belongs to one organization and maps to one profile. Unique `(organization_id, profile_id)`. Active status and employee number live here. |
| `employee_stores` | Assignment join table: `(employee_id, store_id)` is unique. Both rows must share an organization, validated by database constraints or a trigger. |
| `roles` | Organization-owned roles. A seeded owner role is created during organization bootstrap. |
| `permissions` | Controlled permission catalogue; immutable code is the primary key. |
| `role_permissions` | Join table from roles to permissions. |
| `employee_roles` | Join table from employees to roles, unique by `(employee_id, role_id)`. |
| `employee_invitations` | Expiring, email-bound onboarding record with one initial role and store. Stores only a token hash and immutable display snapshots; acceptance atomically creates the employee and assignments. |

Core indexes include `stores(organization_id)`, `registers(store_id)`, `employees(organization_id, profile_id)`, the membership join keys, and role/permission joins. RLS helper predicates must resolve membership by the caller's verified profile identity and target organization/store.

### Phase 2: catalogue and basic inventory

| Table | Purpose and key relationships |
| --- | --- |
| `categories` | Organization-owned, ordered category list; archived categories remain referentially intact. |
| `products` | Organization-owned product master: name, SKU, barcode, category, price and cost in minor units, inventory tracking flag, status. |
| `product_variants` | Optional saleable variants, each belonging to one product with its own SKU/barcode/price/cost. |
| `product_store_settings` | Per-store availability and future store overrides; unique `(store_id, product_id)`. |
| `inventory_levels` | Store-level projection for a saleable product or variant. A uniqueness constraint prevents duplicate stock rows for one store and saleable item. |
| `inventory_movements` | Append-only stock ledger: store, saleable item, signed quantity delta, movement type, actor, reason, source reference, timestamp. |

SKU and barcode lookups are indexed per organization. Product/category foreign keys are indexed. `inventory_movements.quantity_delta` cannot be zero; movement inserts update the matching `inventory_levels` projection in the same transaction. Direct updates to the projection are prohibited outside controlled inventory routines.

### Phase 3: basic POS

No persistent order tables are required. The POS reads a paginated, indexed catalogue and maintains a temporary client cart. Search supports product name, SKU, and barcode but does not load the whole catalogue into the browser.

### Phase 4: configurable checkout and payments

| Table | Purpose and key relationships |
| --- | --- |
| `checkout_requests` | Idempotency record keyed by `(organization_id, idempotency_key)`, with actor, canonical request payload, state, resulting sale ID, and timestamps. |
| `sales` | Immutable completed-sale header: organization, store, register, cashier and display snapshots, monetary totals in minor units, status, completed timestamp. |
| `sale_items` | Immutable line snapshots: sale, product/variant reference, name/SKU snapshot, quantity, unit price, discount, tax, and line total. |
| `payment_methods` | Organization payment-method definitions: stable code/type, display name, enabled/reference requirements, and sort order. |
| `store_payment_methods` | Normalized per-store availability for each organization payment method. |
| `payments` | One-to-many immutable sale payments: method ID/type/name snapshots, applied amount, optional reference/note, and cash tender/change in minor units. |
| `receipts` | One immutable receipt per completed sale with a unique receipt number within its organization. |

The payment enhancement supports multiple store-enabled methods per sale. Payment records retain a stable method type and display snapshot for later receipt history, reporting, and cash-shift calculations; only `CASH` records carry tender/change metadata.

`sales`, `sale_items`, `payments`, and `receipts` are created by one transaction only. Amounts use `integer` or `bigint` minor units with non-negative checks; the final sales total is calculated in the database, never trusted from the client. A completed sale is not deleted or edited to represent a refund. The same transaction appends a `SALE` inventory movement for each tracked line and updates the stock projection. Phase 6 assigns every new sale to its locked, open register shift at the database boundary.

### Phase 5: receipts and refunds

| Table | Purpose and key relationships |
| --- | --- |
| `refunds` | Immutable refund header linked to the original completed sale, its store/register, refunding employee, reason, currency, and unique organization refund number. |
| `refund_items` | Immutable line snapshots tied to original sale items; their quantities are accumulated to prevent over-refunds. |
| `refund_payments` | Stable payment-method snapshot and reference for a monetary refund. |
| `refund_requests` | Private idempotency state keyed by organization and client-generated refund key. |

Receipt history reads the original sale, line, payment, receipt, and refund snapshots under `receipts.view`; printing is separately controlled by `receipts.reprint`. The `refund_sale` database boundary requires `sales.refund`, locks the original completed sale and relevant stock projections, records an immutable refund, and restores inventory only where the original sale appended a `SALE` movement. Original financial records remain unchanged.

### Phase 6: register shifts and cash control

| Table | Purpose and key relationships |
| --- | --- |
| `shifts` | Immutable register lifecycle record: opening employee/cash, open or closed state, closer, server-derived expected cash, counted cash, difference, notes, and timestamps. A partial unique index allows one open shift per register and per employee. |
| `cash_movements` | Append-only pay-in/pay-out ledger entry tied to a shift, store, register, employee, reason, amount, and organization-scoped idempotency key. |

Opening, closing, and cash movement RPCs use a fixed `search_path`, scoped role permissions, active employee-store assignment checks, and short row locks on the shift. A sale or refund trigger locks and assigns the current cashier's open shift; direct table writes remain unavailable. Expected cash is derived only from opening cash, net `CASH` payments, cash refund payments, pay-ins, and pay-outs. Closing records the derived expected amount, counted drawer cash, and their difference in the same protected transaction.

### Phase 7: customers and loyalty

| Table | Purpose and key relationships |
| --- | --- |
| `customers` | Organization-scoped CRM profile with contact details, optional birthday/notes, and an archive state. Completed sales may reference one customer. |
| `loyalty_programs` | One per organization; enables or disables earning/redemption and defines spend, points, redemption value, and redemption minimum in minor units/whole points. |
| `loyalty_transactions` | Append-only customer points ledger for sale earning, POS redemption, and earned-point reversal on refunds. Customer point balances are always derived by summing this table. |

Phase 7 extends `sales` with an optional customer reference plus immutable loyalty snapshots. Redemptions create a system-owned `LOYALTY` voucher payment rather than changing merchandise pricing. This keeps sales totals, payment sums, receipts, refund values, and Phase 6 cash expectations consistent. The checkout boundary locks the active customer before checking the ledger balance, validates the current program, records redemption and earning in the same transaction as checkout, and preserves idempotency. A refund reverses the earned portion of points proportionally through another ledger row; no client can insert or alter ledger records directly.

## Phase 1 implementation status

1. **Supabase project contract — implemented**
   - **Goal:** Add browser/server client boundaries, cookie session-refresh strategy, and validated environment access.
   - **Files:** `.env.example`, `src/lib/supabase/*`, `src/app/proxy.ts` when the Auth route boundary exists.
   - **Database:** none.
   - **Dependencies:** Supabase project URL and publishable key.
   - **Definition of Done:** unauthenticated and authenticated requests are handled without exposing secrets; missing environment configuration fails clearly on server startup.

2. **Organization and identity migration — implemented**
   - **Goal:** Create the organization, profile, store, register, and employee relationship model.
   - **Files:** `supabase/migrations/*`, generated database types, organization service tests.
   - **Database:** `organizations`, `profiles`, `stores`, `registers`, `employees`, and `employee_stores` with constraints and indexes.
   - **Dependencies:** Supabase CLI/project link and the chosen organization bootstrap flow.
   - **Definition of Done:** a test organization can be created, an authenticated owner is associated with it, and cross-organization reads return no rows.

3. **Roles and permissions migration — implemented**
   - **Goal:** Model tenant-scoped roles and server-checkable permissions.
   - **Files:** migration, permission catalogue, authorization helpers, tests.
   - **Database:** `roles`, `permissions`, `role_permissions`, and `employee_roles`.
   - **Dependencies:** employee identity model.
   - **Definition of Done:** owner, manager, and cashier examples produce distinct permission results in database and server tests.

4. **RLS and API privilege policy — implemented and locally verified**
   - **Goal:** Enforce tenant/store boundaries at the database layer.
   - **Files:** additive policy migration and RLS test fixtures.
   - **Database:** RLS enabled on every exposed table, minimal object grants, membership/permission predicates, indexes supporting those predicates.
   - **Dependencies:** Phase 1 tables and an authenticated test-user setup.
   - **Definition of Done:** access tests prove that a user cannot select, insert, update, or delete records outside assigned organization/store scope.

5. **Authenticated Back Office shell and management workflows — implemented**
   - **Goal:** Provide the protected application frame and authorized store/register setup screens.
   - **Files:** route-group layout, feature components, form schema, server actions, shadcn/ui primitives.
   - **Database:** none beyond prior migrations.
   - **Dependencies:** authentication and authorization helpers.
   - **Definition of Done:** an owner can create stores/registers and custom roles, invite an employee, and accept that invitation with the matching Auth identity; unauthorized and privilege-escalating requests are denied by both server and database checks.

6. **Verification and handoff — implemented and locally verified**
   - **Goal:** prove the business setup is safe to build upon.
   - **Files:** tests and deployment/environment documentation as needed.
   - **Database:** no unplanned schema changes.
   - **Dependencies:** a disposable Supabase environment.
   - **Definition of Done:** lint, TypeScript, production build, local migration replay, cross-tenant RLS tests, and Supabase security/advisor checks pass.

## Phase 2 implementation status

1. **Catalogue schema and identifiers — implemented**
   - **Goal:** Model ordered categories, simple products, variant products, pricing, cost, SKUs, barcodes, units, archive state, and per-store availability.
   - **Files:** `supabase/migrations/20260821045609_phase_2_catalog_inventory.sql`, `src/lib/supabase/database.types.ts`.
   - **Database:** `categories`, `products`, `product_variants`, and `product_store_settings`, including composite tenant foreign keys and indexed identifiers.
   - **Definition of Done:** one atomic routine creates a product, its variants, store settings, and initial stock projections; identifiers cannot be ambiguous across products and variants within an organization.

2. **Basic inventory ledger — implemented**
   - **Goal:** Maintain exact current stock without permitting silent balance rewrites.
   - **Files:** Phase 2 migration and database tests.
   - **Database:** `inventory_levels`, `inventory_movements`, and the controlled `adjust_inventory` routine.
   - **Definition of Done:** opening stock and signed adjustments lock and update one projection while appending a mathematically consistent ledger entry in the same transaction. Duplicate opening stock and direct projection/ledger writes are rejected.

3. **Least-privilege catalogue access — implemented**
   - **Goal:** Separate catalogue management, stock management, and cost visibility.
   - **Files:** Phase 2 RLS migration, Server Actions, and `phase_2_rls.test.sql`.
   - **Database:** RLS on all six Phase 2 tables, explicit Data API grants, permission-checking routines, and a separate cost lookup boundary.
   - **Definition of Done:** cross-organization access is blocked; ordinary members can read safe catalogue and level fields; only approved roles can mutate catalogue, see cost, inspect the movement ledger, or adjust stock.

4. **Back Office catalogue and inventory — implemented**
   - **Goal:** Let an authorized owner or manager configure categories and products, then establish and review basic stock.
   - **Files:** `src/features/catalog/*`, `/back-office/categories`, `/back-office/catalog`, `/back-office/inventory`, and the Back Office navigation.
   - **Definition of Done:** validated Server Actions support categories, simple/variant products, prices, identifiers, inventory toggles, store availability, archive state, opening stock, adjustments, current levels, and recent movements.

5. **Verification — implemented**
   - **Goal:** Prove the migration, authorization model, and application compile safely before Phase 3.
   - **Definition of Done:** a clean local database replay passes all Phase 1 and Phase 2 pgTAP tests and the Supabase advisors; TypeScript, lint, and the production build pass.

## Phase 3 implementation status

1. **Secure, paginated POS catalogue — implemented**
   - **Goal:** Return only saleable items for the cashier's active, assigned store without exposing product cost or loading the entire catalogue into the browser.
   - **Files:** `supabase/migrations/20260821061248_phase_3_pos_catalog_search.sql`, `/api/pos/catalog`, and `src/features/pos/pos-types.ts`.
   - **Database:** `search_pos_catalog` is an authenticated, store-assignment-aware, security-invoker query boundary. It returns active simple products and active variants only, supports product/variant name, SKU, and barcode matching, and is capped at 24 rows per page. Trigram indexes support catalogue text search.
   - **Definition of Done:** an assigned cashier with `sales.create` can page and search their store catalogue; another organization, an unassigned store, oversized requests, and cost data are denied or excluded.

2. **Basic POS terminal — implemented**
   - **Goal:** Let a cashier browse categories, add scanned or selected items, adjust quantities, and see a reliable cart total.
   - **Files:** `/pos`, `src/features/pos/pos-terminal.tsx`, and Back Office navigation.
   - **Definition of Done:** store switching clears the local cart, repeated item selection increments quantity, barcode/SKU Enter adds an exact match, product grids are paginated, and totals use product minor-unit prices.

3. **Phase boundary — complete**
   - **Goal:** Keep the cart disposable while giving Phase 4 a small, audited checkout input.
   - **Definition of Done:** the browser holds only the draft cart; checkout submits item references, quantities, register, selected payment method IDs/amounts, and an idempotency key to the Phase 4 database boundary.

## Phase 4 implementation status

1. **Immutable cash-sale records — implemented**
   - **Goal:** Persist a completed sale, line snapshots, one or more payment records, and one receipt with minor-unit money checks.
   - **Files:** `supabase/migrations/20260821063657_phase_4_cash_checkout.sql`, database types, and Phase 4 schema tests.
   - **Database:** `sales`, `sale_items`, `payments`, `receipts`, and `checkout_requests`, all with RLS and least-privilege object grants.
   - **Definition of Done:** authenticated callers cannot write financial records directly; only authorized receipt readers can select completed-sale records.

2. **Atomic and idempotent checkout — implemented**
   - **Goal:** Make one-or-more payment records, cash tender/change, receipt issuance, and tracked inventory deduction one all-or-nothing transaction.
   - **Files:** the Phase 4 migrations, `src/features/checkout/*`, `phase_4_cash_checkout.test.sql`, and `phase_4_payment_methods.test.sql`.
   - **Database:** `checkout_sale` derives active store catalogue prices, validates the assigned employee/register and store-enabled payment methods, calculates totals/change, and appends `SALE` movements while locking stock projections. `checkout_cash_sale` remains a compatibility adapter.
   - **Definition of Done:** a repeated identical idempotency key returns the first result without another sale or stock deduction; a changed payload is rejected.

3. **Cash checkout terminal — implemented**
   - **Goal:** Let a cashier select an active register, enter tendered cash, preview change, and receive a receipt confirmation.
   - **Files:** `/pos`, `src/features/pos/pos-terminal.tsx`, and secure checkout Server Action.
   - **Definition of Done:** the terminal never sends prices/totals/receipt numbers, disables the charge while a checkout is pending, and clears the cart only after a successful transaction.

## Phase boundaries

- **Phase 0 (complete):** framework, design system, project conventions, environment contract, ERD, and delivery plan.
- **Phase 1 (complete):** authentication, organization, store/register creation, employee invitation acceptance, least-privilege custom roles, permissions, protected management views, and RLS migrations.
- **Phase 2 (implemented):** categories, simple and variant products, pricing and cost permissions, SKU/barcode fields, per-store availability, inventory tracking, current stock, and opening/adjustment ledger movements.
- **Phase 3 (implemented):** store-scoped paginated catalogue browse/search/scan and an in-memory cart with quantity controls and totals.
- **Phase 4 (implemented):** transaction-safe cash checkout, change calculation, immutable receipt/payment/sale records, and tracked inventory deduction.
- **Phase 5 (implemented):** receipt history, immutable receipt detail/printing, and authorized partial or full refunds with replay protection and tracked-stock restoration.
- **Phase 6 (implemented):** opening/closing shifts, server-derived cash expectations, idempotent pay-ins/pay-outs, drawer counts, discrepancies, and a POS open-shift guard.
- **Phase 7 (implemented):** customer CRM, POS customer assignment, protected purchase history, configurable loyalty earning/redemption, an immutable points ledger, checkout replay protection, and earned-point refund reversals.
