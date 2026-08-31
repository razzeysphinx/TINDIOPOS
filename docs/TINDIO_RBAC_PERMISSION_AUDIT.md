# TINDIO RBAC and permission audit

Audit date: 2026-08-31  
Scope: the complete current Next.js application, local Supabase schema, RLS policies, table/function grants, preset-role provisioning, server actions, route handlers, POS/device paths, and public/tokenized endpoints.

## Decision model

Every protected operation follows this chain:

```text
Authenticated user
  -> active employee in the selected organization
  -> role_permissions capability set
  -> feature flag where applicable
  -> organization-wide or assigned-store scope
  -> server action/API service guard
  -> guarded RPC or RLS-protected table operation
```

`roles.code` is used only when provisioning the predefined bundles. Runtime access is derived from `role_permissions`; therefore a customer-created role automatically works when it has the required capability.

### Store-scope terms

| Term | Meaning |
| --- | --- |
| `O` | Organization-wide store scope. Granted by the `stores.manage` capability; no employee-store link is required. |
| `S` | Assigned-store scope. The employee must have an active `employee_stores` link for each branch record. |
| `C` | Custom role. It receives exactly the permissions configured by the business; its scope is `S` unless it is explicitly granted `stores.manage`, in which case it becomes `O`. |

The shared application resolver now returns the complete organization store set for any user with `stores.manage`. This mirrors `private.has_organization_store_scope` and `private.has_store_read_scope` in Postgres. It fixes raw `context.storeIds` consumers in POS checkout, receipts, shifts, reports, inventory, kitchen, time clock, POS APIs, and Back Office filters without an Owner-name exception.

## Root causes found and corrected

| Finding | Root cause | Correction |
| --- | --- | --- |
| Owner Store Pricing/low-stock save returned permission denied | The `product_store_settings` upsert supplied `price_override_minor` and `low_stock_level`, but the authenticated role only had `UPDATE`, not `INSERT`, on those columns. PostgreSQL therefore rejected the statement before RLS could evaluate `products.manage`. | `20260831022507_catalog_store_configuration_permission_alignment.sql` grants only the missing insert columns. Existing RLS capability and store-scope policies remain authoritative. |
| Application and RLS disagreed on store authority | RLS treats `stores.manage` as organization-wide, while `BusinessContext.storeIds` previously contained only physical `employee_stores` links. Several routes/actions then independently denied valid organization-wide users. | Shared resolver and database predicate now use the same capability definition. Owner/Admin/custom roles with `stores.manage` receive `O`; all other roles remain `S`. |
| Admin preset drifted into an Owner-only capability | Older Admin rows were granted `recovery.manage`; the organization bootstrap function continued to grant it to every new Admin role. | Existing rows are repaired and the bootstrap provisioner now excludes `recovery.manage`. This is a documented default-bundle restriction, not a runtime hardcoded access rule. |
| Internal trigger routines were directly executable by anonymous clients | PostgreSQL's inherited function grants left two `private` trigger procedures executable even though they require trigger context. | `20260831025648_rbac_internal_function_grants.sql` revokes all direct client execution. Trigger execution remains intact. |

## Preset role matrix

| Role | Current default capabilities | Scope | Accessible areas and actions |
| --- | --- | --- | --- |
| Owner | All registered permissions (51 at audit time) | `O` | All Back Office, POS, reports/exports, configuration, employees/roles/stores/devices, refunds, audit, lifecycle, and recovery drills. |
| Admin | All default capabilities except `organization.manage`, `organization.archive`, `organization.lifecycle`, and `recovery.manage` (47 at audit time) | `O` | All normal administration, POS, reports/exports, stores/registers/devices, security configuration, and recovery viewing. No ownership lifecycle or recovery-drill recording by default. |
| Manager | 39 operational permissions | `S` | POS sales/payment/shift/receipt/refund, catalog, inventory, customers, assigned-team operations, reports, audit, kitchen, and assigned registers. No role/store/device/global-settings authority. |
| Cashier | 14 POS permissions | `S` | POS sales/payment, permitted discounts, tickets, shift/cash operations, receipt history/reprint, and manager-approval requests. No Back Office administration, refunds, inventory, catalog configuration, or reports. |
| Inventory Staff | 11 inventory/catalog permissions | `S` | Products/costs and inventory operations including counts, adjustments, receipts, purchase orders, transfers, and suppliers. No POS, payments, cash, customers, reports, or organization management. |
| Customer-created role | Exactly the selected `role_permissions` | `C` | No code-path depends on the role name. A configured capability opens its matching page/action; backend/RLS still enforce it. |

## Module × action × role/scope matrix

`Allow` below means the named role's default bundle includes the listed capability. Feature flags and the active-organization lifecycle gate still apply. A custom role is allowed only when it has the listed capability and scope.

| Module / protected operation | Required capability or guard | Owner | Admin | Manager | Cashier | Inventory Staff | Custom role |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Dashboard / Time Clock page | `dashboard.view`; time clock also requires enabled feature | Allow `O` | Allow `O` | Allow `S` | No Back Office | No | Capability + scope |
| Reports / report CSV export / print | `reports.view` plus report store scope | Allow `O` | Allow `O` | Allow `S` | Deny | Deny | `reports.view` + `S`/`O` |
| Catalog, categories, products, variants, availability, price/low stock, units, recipes | `products.manage`; store settings also store scope | Allow `O` | Allow `O` | Allow `S` | Deny | Allow `S` | `products.manage` + `S`/`O` |
| Product cost visibility | `products.view_cost` | Allow | Allow | Allow `S` | Deny | Allow `S` | `products.view_cost` |
| Discounts, taxes, dining, modifiers, ticket templates | `products.manage` plus enabled feature | Allow `O` | Allow `O` | Allow `S` | Deny | Allow `S` | `products.manage` + flag |
| Inventory, suppliers, purchase orders, counts, adjustments, transfers, receipts | `inventory.*`; `products.view_cost` where cost is returned | Allow `O` | Allow `O` | Allow `S` | Deny | Allow `S` | Matching `inventory.*` + `S`/`O` |
| Customers, loyalty, segments, import/export | `customers.manage`; POS customer lookup also `pos.access` + `sales.create` | Allow `O` | Allow `O` | Allow `S` | POS lookup only `S` | Deny | Matching capability + scope |
| Employees and invitations | `employees.manage`; employee-store visibility is separately scoped | Allow `O` | Allow `O` | Assigned-team `S` | Deny | Deny | `employees.manage` + scope |
| Roles and permission bundles | `roles.manage`; RLS prevents granting permissions the actor does not hold | Allow `O` | Allow `O` | Deny | Deny | Deny | `roles.manage` subject to grant ceiling |
| Stores / registers / POS devices | `stores.manage`, `registers.manage`, or `devices.manage` respectively | Allow `O` | Allow `O` | Registers only `S` | Deny | Deny | Matching capability; `stores.manage` creates `O` |
| Business profile, payment methods, receipt settings, smart menu, feature settings | `settings.manage` | Allow `O` | Allow `O` | Deny | Deny | Deny | `settings.manage` |
| POS catalog, scan, cart, checkout, payments, offline sync | `pos.access` + `sales.create` + `payments.accept`; active register/device and active shift are enforced by RPC | Allow `O` | Allow `O` | Allow `S` | Allow `S` | Deny | All three + `S`/`O` |
| POS discounts / open tickets / quantity and removal | `discounts.apply`, `tickets.manage`, `pos.edit_quantity`, `pos.remove_item` | Allow | Allow | Allow `S` | Allow `S` where bundled | Deny | Exact capability + POS guard |
| Receipts, detail, reprint | `receipts.view`, `receipts.reprint`, store receipt scope | Allow `O` | Allow `O` | Allow `S` | Allow `S` | Deny | Matching capability + `S`/`O` |
| Refund / void / exchange | `sales.refund` + `sales.create`, or a valid manager approval where configured | Allow `O` | Allow `O` | Allow `S` | Deny unless approved under a rule | Deny | Matching capability/approval + scope |
| Shifts, cash in/out, close, expected-cash view, history / shift print | Matching `shifts.*` and `cash.*`; active shift/register/device checks; blind-cash behavior in RPC | Allow `O` | Allow `O` | Allow `S` | Allow `S` per bundle | Deny | Exact capability + `S`/`O` |
| Kitchen display and station updates | `kitchen.view` / `kitchen.manage` + enabled feature | Allow `O` | Allow `O` | Allow `S` | Deny | Deny | Matching capability + scope |
| Security approvals / audit | `approvals.manage`, `approvals.authorize`, `approvals.request`, `audit.view` as applicable | Allow `O` | Allow `O` | Authorize/view `S` | Request `S` | Request `S` | Exact capability + scope |
| Organization export / lifecycle / recovery | `organization.export`; lifecycle capabilities; `recovery.view` / `recovery.manage` | Allow `O` | Export/view only | Deny | Deny | Deny | Explicitly granted capability; lifecycle is normally Owner-only |

## Cross-layer inventory

| Layer | Audited coverage | Result |
| --- | --- | --- |
| Back Office routes | Every `src/app/(back-office)/back-office/**/page.tsx` is required by regression test to declare `requireBackOfficePermission` or `requireBackOfficeContext`. | All current pages have a server-side route boundary. |
| Server actions | Catalog, inventory/supply chain, customers/loyalty, management, devices, payments, shifts/cash, receipts/refunds, checkout, advanced sales/tickets, kitchen, business profile, smart menu, approvals, organization lifecycle/recovery, time clock, POS favorites, and onboarding/auth were traced. | Protected actions derive organization identity from the session; public auth/onboarding actions are intentionally separate. Delegating organization services use `requireUser` plus guarded RPCs. |
| API routes | Catalog/customers/inventory/reports/organization exports and all POS catalog, checkout, customer, modifier, device, customer-display, and offline-checkout endpoints were traced. | Authenticated routes resolve `getBusinessContext` and capability/service guard. Offline checkout delegates to the same checkout authorization and idempotency path. |
| POS / device / shift | Checkout, open tickets, device credentials, receipts, cash movements, shift close/summary, and offline telemetry were reviewed. | Guarded RPCs enforce capabilities, organization/store/register identity, active shift, device validation, idempotency, and blind-cash visibility. |
| RLS and table grants | Every public application table has RLS enabled. Store-bound policies use the shared scope predicate. Table grants are evaluated before RLS; the catalog upsert grant was corrected accordingly. | No RLS-disabled public table found by local advisor/query. |
| RPC / security definer | Executable public security-definer functions were inventoried. Authenticated procedures are capability/ownership/store guarded; private helpers are not directly granted. | The only anonymous public procedures are tokenized customer display, public smart menu, and loyalty QR verification. Internal trigger grants were revoked. |
| Tenant isolation | Server context selects an active employee/organization, services use its organization id, and RLS/RPCs re-check tenant and record scope. Existing attack tests cover cross-organization writes, direct checkout, tax/payment/device changes, refunds, shifts, and inventory. | Preserved and extended by the new role/scope matrix. |

## Regression evidence

| Test | What it proves |
| --- | --- |
| `supabase/tests/database/rbac_permission_matrix.test.sql` | Owner, Admin, Manager, Cashier, Inventory Staff, and a custom role: allowed/denied catalog store-configuration writes, `O`/`S` scope, complete Owner bundle, Admin recovery exception, RLS enabled, and anonymous RPC boundary. |
| `supabase/tests/database/catalog_product_update_authorization.test.sql` | Owner capability synchronization, price/low-stock upsert grant, product availability, product update, and denied cross-store manager operations. |
| `supabase/tests/database/owner_store_access_and_self_edit.test.sql` | Existing automatic store-assignment compatibility and owner/custom organization-manager assignment behavior. |
| `supabase/tests/database/rbac_capability_coverage.test.sql` | Customer-created POS role behavior and direct RPC capability checks. |
| `scripts/phase-7-security-boundary-check.mjs` | Every Back Office route boundary, sensitive server actions, authenticated exports/offline sync, POS API gates, and source-level scope resolver alignment. |
| Existing database attack suites | Negative paths for tenant isolation, tax/payment/device changes, refunds, inventory, shifts, feature flags, and checkout. |

## Intended public and system restrictions

- Auth, invitation acceptance, public smart menu, customer-display access-token pages, and loyalty QR verification are intentionally not normal Back Office routes.
- A Cashier does not receive Back Office access merely because they can use POS.
- `organization.manage`, organization lifecycle, and `recovery.manage` are excluded from Admin by default; an Owner may create a custom role with an explicit capability where the policy allows it.
- No manual sync button replaces automatic offline synchronization; authorization remains inside the checkout/RPC path.

## Candidate for removal (not removed)

- `CANDIDATE_FOR_REMOVAL`: legacy automatic `employee_stores` synchronization for organization managers is now redundant for authorization because `stores.manage` defines organization-wide scope. It remains for compatibility, employee management displays, and existing workflows. Do not delete it without a migration, data review, and focused regression plan.

## Remaining verification required

- Database migrations are applied only to the local Supabase environment in this audit. Apply them to the intended environment through the normal reviewed migration process, then rerun the same database tests there.
- The in-app browser was unavailable in this session, so the following require a final human/browser pass after refreshing the app: Owner save of store price/low stock; Admin/Manager/Cashier/Inventory Staff/custom-role navigation; POS checkout/refund/shift; report export; and unauthorized direct-url attempts.
- Preset bundles are intentionally broad in places (for example Manager catalog/inventory access). Product policy decisions can narrow a bundle by changing `role_permissions`, without adding role-name checks.
