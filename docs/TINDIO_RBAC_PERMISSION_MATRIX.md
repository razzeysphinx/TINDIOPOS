# TINDIO RBAC Permission Matrix

## Authorization model

TINDIO authorizes an action from the effective permission codes assigned to the active employee in the active organization. A role is only a reusable bundle stored in `roles` and `role_permissions`; it is not an authorization shortcut. The same path is used for every preset and customer-created role:

`authenticated user -> active employee -> active organization -> assigned stores -> role_permissions -> required capability -> feature / shift / device / approval checks`

The client uses the same capability data only to hide unavailable navigation and controls. Server actions, API routes, RPCs, and RLS are still the authority. Organization IDs are derived from the active server context or verified inside each RPC; store-scoped records are additionally checked against the employee's assigned stores.

## Preset bundles

These are the current predefined bundles. A business can create another role, give it any supported codes below, and assign it to employees without changing application code.

| Preset role | Permissions | Accessible pages and actions |
| --- | --- | --- |
| Owner (51) | All listed permission codes. | Full Back Office, organization lifecycle and recovery, all operational POS functions, all reports/audits, all configuration. |
| Admin (48) | All codes except `organization.manage`, `organization.archive`, and `organization.lifecycle`. | Full Back Office administration, POS, reporting, audit, recovery, and operational controls; cannot change organization ownership/lifecycle. |
| Manager (39) | `approvals.authorize`, `approvals.request`, `audit.view`, `cash_drawer.open`, `cash.pay_in`, `cash.pay_out`, `customers.manage`, `dashboard.view`, `discounts.apply`, `employees.manage`, `inventory.adjust`, `inventory.count`, `inventory.manage`, `inventory.purchase_orders`, `inventory.receive`, `inventory.suppliers`, `inventory.transfers`, `inventory.view`, `kitchen.manage`, `kitchen.view`, `payments.accept`, `pos.access`, `pos.edit_quantity`, `pos.remove_item`, `prices.override`, `products.manage`, `products.view_cost`, `receipts.reprint`, `receipts.view`, `registers.manage`, `reports.view`, `sales.create`, `sales.refund`, `shifts.close`, `shifts.force_close`, `shifts.open`, `shifts.view_expected_cash`, `shifts.view_history`, `tickets.manage`. | Dashboard, reports, catalog, inventory, customers, employees, registers, kitchen, permitted security/audit pages, and complete operational POS. No role/store/settings/business-profile administration. |
| Cashier (14) | `approvals.request`, `cash.pay_in`, `cash.pay_out`, `discounts.apply`, `payments.accept`, `pos.access`, `pos.edit_quantity`, `pos.remove_item`, `receipts.reprint`, `receipts.view`, `sales.create`, `shifts.close`, `shifts.open`, `tickets.manage`. | POS Sales, operational Items/Settings, receipts/reprint, open tickets, open/close shift, and cash pay-in/pay-out. No Back Office shell or configuration access. |
| Inventory Staff (11) | `approvals.request`, `inventory.adjust`, `inventory.count`, `inventory.manage`, `inventory.purchase_orders`, `inventory.receive`, `inventory.suppliers`, `inventory.transfers`, `inventory.view`, `products.manage`, `products.view_cost`. | Catalog and inventory operations allowed by `products.manage`/`inventory.manage`; no POS, cash, employee, role, store, or report access. |

The live **Back Office > Team > Roles** screen remains the tenant-specific source for customer-created roles and changes made by an owner. This document records the shipped preset baseline; it does not replace the live data.

## Capability-to-surface matrix

| Permission | Enforced surface |
| --- | --- |
| `dashboard.view` | Back Office dashboard route and navigation. |
| `reports.view` | Reports routes and export API. |
| `products.manage` | Catalog administration, product/store availability, categories, modifiers, discounts, and catalog exports. |
| `products.view_cost` | Cost values in catalog/inventory views and exports. |
| `inventory.manage` | Current inventory workspace, stock changes, suppliers, purchase orders, receives, and transfers. |
| `customers.manage` | Back Office customer profiles, segments, import, loyalty administration, and customer exports. |
| `employees.manage` | Employees, invitations, employee store assignment, and ticket assignment. |
| `roles.manage` | Customer role creation/update and employee role assignment. A grantor may only grant codes they already hold. |
| `stores.manage` / `registers.manage` / `devices.manage` | Respective Back Office management pages, server actions, APIs, and tenant/store checks. |
| `organization.manage`, `organization.export`, `organization.archive`, `organization.lifecycle`, `recovery.view`, `recovery.manage` | Business profile, export, lifecycle, and recovery workflows. |
| `settings.manage` | Organization-level settings, payment configuration, feature settings, receipt configuration, and shift cash-visibility setting. |
| `approvals.manage` / `audit.view` | Approval-rule and security/audit Back Office surfaces. |
| `kitchen.view` / `kitchen.manage` | Kitchen workspace / kitchen administration actions. |
| `pos.access` + `sales.create` | POS Sales route, POS catalog/modifier/customer/customer-display APIs, and ticket server actions. |
| `payments.accept` | Checkout service and `checkout_advanced_sale` RPC. |
| `discounts.apply` | POS discount selector and direct checkout with a discount. |
| `tickets.manage` | Open-ticket loading, ticket server actions, direct ticket RPC reads/mutations, and checkout of a saved ticket. |
| `pos.edit_quantity` / `pos.remove_item` | Quantity controls and removal/clear-cart controls in POS. |
| `receipts.view` / `receipts.reprint` / `sales.refund` | POS receipt history/detail, reprint control, and refund operation. |
| `shifts.open`, `shifts.close`, `cash.pay_in`, `cash.pay_out` | POS shift route, server actions, shift RPCs, and cash-movement audit trail. |
| `shifts.view_history` | Closed-shift audit history and detail report. |

## Defined capabilities with no separate current surface

The following codes are present in the permission catalog and preset bundles, but the current UI does not yet expose a distinct capability boundary beyond an existing broader workflow. They are retained deliberately and are **CANDIDATE_FOR_REMOVAL_OR_FUTURE_WIRING**; no code or data has been deleted:

- `approvals.request`, `approvals.authorize`, `approvals.bypass`
- `cash_drawer.open`
- `inventory.view`, `inventory.adjust`, `inventory.count`, `inventory.purchase_orders`, `inventory.receive`, `inventory.suppliers`, `inventory.transfers` (the current inventory workspace still requires `inventory.manage`)
- `prices.override`
- `shifts.force_close`, `shifts.view_expected_cash`

Before granting one of these codes to a custom role as its only authority, attach it to a concrete server action/RPC/RLS policy and add a regression test. Until then, grant the documented broader capability (for example, `inventory.manage`) for the existing workflow.

## Adding a future permission safely

1. Add the code and description in a migration.
2. Define the required capability at the protected server action/API/RPC and its RLS/private database function.
3. Add UI visibility from the same permission code; never use a role name to decide access.
4. Update preset bundles only if the product decision calls for it. Custom roles need no code update.
5. Add a direct-call negative database test and a route/action regression test.

This keeps a new feature attachable to a permission code without a new role branch, while preserving tenant and store isolation.
