# SUPERSEDED — historical deletion-planning evidence only

This document is preserved as historical evidence of a pre-incident planning
state. It is not executable and grants no deletion authority. On 2026-10-05,
the required control tenant `RAZZEY TRADING CORP.` was archived through the
canonical lifecycle during the intended certification-tenant workflow, while
`TINDIO Phase 04 Certification` remained active and unarchived. The current
control-tenant incident blocks any certification-tenant archive or deletion
action pending a separately authorized RAZZEY recovery decision. Do not use
this document to change live data, bypass lifecycle controls, or delete an
identity. See `post-r9-razzey-archive-incident.md`.

---

# Certification tenant deletion exact plan

Generated: 2026-10-05T09:05:00Z
Target: `TINDIO Phase 04 Certification` (`baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9`)
Canonical Neon: `divine-sound-41148108` / `br-snowy-heart-b5nf6q3n` / `tindio_r6_recovery`

## Deterministic graph result

- Approved non-zero tenant relations: 34.
- Active FK edges between approved relations: 81.
- Cycles: none.
- Tie-break: schema name, then table name.
- Excluded edge: `organizations_archive_request_actor_fkey`; the target row’s archive-request actor is NULL, so this nullable reference has no row-level dependency.
- All steps use the approved direct tenant predicate. The final organization step uses its exact primary-key predicate.
- This plan preserves `public.profiles`, `private.identity_links`, and the Supabase Auth user.

## Ordered delete steps

| Step | Relation | Expected rows | Target predicate | FK reason |
| ---: | --- | ---: | --- | --- |
| 1 | `private.organization_data_governance` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.organizations. |
| 2 | `public.advanced_checkout_requests` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.employees, public.organizations, public.sales. |
| 3 | `public.approval_rules` | 9 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.organizations. |
| 4 | `public.audit_logs` | 11 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.employees, public.organizations, public.registers, public.stores. |
| 5 | `public.checkout_requests` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.employees, public.organizations, public.sales. |
| 6 | `public.employee_roles` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.employees, public.organizations, public.roles. |
| 7 | `public.employee_stores` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.employees, public.organizations, public.stores. |
| 8 | `public.inventory_count_lines` | 2 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.inventory_counts, public.products. |
| 9 | `public.inventory_counts` | 2 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.employees, public.organizations, public.stores. |
| 10 | `public.inventory_levels` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.organizations, public.products, public.stores. |
| 11 | `public.inventory_movements` | 4 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.employees, public.organizations, public.products, public.stores. |
| 12 | `public.loyalty_programs` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.organizations. |
| 13 | `public.organization_features` | 14 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.employees, public.organizations. |
| 14 | `public.payments` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.payment_methods, public.sales. |
| 15 | `public.product_store_settings` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.organizations, public.products, public.stores. |
| 16 | `public.product_units` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.organizations, public.products. |
| 17 | `public.receipt_settings` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.organizations. |
| 18 | `public.receipts` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.sales. |
| 19 | `public.refund_items` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.products, public.refunds, public.sale_items. |
| 20 | `public.refund_payments` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.payment_methods, public.refunds. |
| 21 | `public.refund_requests` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.employees, public.organizations, public.refunds. |
| 22 | `public.refunds` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.employees, public.organizations, public.registers, public.sales, public.shifts, public.stores. |
| 23 | `public.role_permissions` | 193 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.organizations, public.roles. |
| 24 | `public.roles` | 5 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.organizations. |
| 25 | `public.sale_items` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.products, public.sales. |
| 26 | `public.products` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.organizations. |
| 27 | `public.sales` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.employees, public.organizations, public.registers, public.shifts, public.stores. |
| 28 | `public.shifts` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.employees, public.organizations, public.registers, public.stores. |
| 29 | `public.employees` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.organizations. |
| 30 | `public.registers` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.organizations, public.stores. |
| 31 | `public.store_payment_methods` | 6 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.payment_methods, public.stores. |
| 32 | `public.payment_methods` | 6 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.organizations. |
| 33 | `public.stores` | 1 | `organization_id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Deleted before public.organizations. |
| 34 | `public.organizations` | 1 | `id = 'baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9'::uuid` | Leaf relation under the approved tenant scope. |

The machine-readable plan, including every FK’s columns, delete action, deferrability, and step-specific constraints, is in `certification-tenant-deletion-exact-plan.json`.

## Execution guards

1. Recount all 103 approved tables immediately before both dry run and commit.
2. For every step, the actual `DELETE ... RETURNING` count must equal the expected count above.
3. A dry run ends in `ROLLBACK`; the live run differs only by the terminal `COMMIT`.
4. Any count/FK/orphan/control-tenant mismatch aborts the transaction.
