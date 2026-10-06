# Certification tenant deletion preflight — read-only evidence

> **SUPERSEDED — historical deletion-preflight evidence only.** This preflight
> is preserved as a dated snapshot, not an active execution authority. The
> RAZZEY control tenant is now archived, and the certification tenant must
> remain active and unarchived until a separately authorized RAZZEY recovery
> decision establishes a valid control-tenant path. No deletion, archive,
> direct status update, owner bypass, or Auth identity action is authorized by
> this document.

Captured: 2026-10-05
Scope: canonical Neon only; no tenant, Auth, or resource deletion was performed.

## Authoritative target

- Organization: `TINDIO Phase 04 Certification`
- ID: `baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9`
- Canonical Neon: `divine-sound-41148108` / `r6-clean-canonical-20261002` (`br-snowy-heart-b5nf6q3n`) / `tindio_r6_recovery`
- Live organization assertion: PASS (exact ID and name).
- Direct tenant-key audit: 103 tables inspected; 34 non-zero and 69 zero.
- Observed tenant data window: 2026-09-23 through 2026-10-02 UTC.
- Stable inventory fingerprint: SHA-256 of this materialized evidence artifact (recorded at handoff).

## Source-of-truth and migration state

- Canonical business database: PASS — Neon target above.
- Supabase business schemas: PASS — `public` and `private` contain zero tables.
- Supabase is Auth-only for this architecture.
- Forward migration `0012_provider_neutral_realtime_dispatch.sql`: APPLIED.
- Direct active SQL `realtime.send` dependency: 0.
- Kitchen durable outbox: present; RLS enabled; authenticated/service SELECT denied.
- Rollback-safe synthetic NEW → PREPARING probe: PASS; zero kitchen/outbox rows remained afterward.

## Direct tenant-keyed inventory

All rows below are direct `organization_id → public.organizations(id)` dependencies. The live FK catalog reports `ON DELETE RESTRICT` for this direct edge; a future deletion must therefore use explicit child-to-parent ordering and current-row assertions.

| Table | Rows | Earliest | Latest | Relationship / delete behavior | Business significance |
| --- | ---: | --- | --- | --- | --- |
| `public.organizations` | 1 | 2026-09-23 02:32:58.105209+00 | 2026-09-23 02:32:58.105209+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant configuration |
| `private.kitchen_order_change_events` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | internal operational record |
| `private.organization_data_governance` | 1 | 2026-09-23 02:32:58.105209+00 | 2026-09-23 02:32:58.105209+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant configuration |
| `private.organization_recovery_drills` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant configuration |
| `private.product_unit_operations` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `private.stock_transfer_operations` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.advanced_checkout_requests` | 1 | 2026-10-02 11:50:35.655717+00 | 2026-10-02 11:50:35.655717+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | sales/financial workflow |
| `public.approval_requests` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.approval_rules` | 9 | 2026-09-23 02:32:58.105209+00 | 2026-09-23 02:32:58.105209+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.audit_logs` | 11 | 2026-09-23 02:32:58.105209+00 | 2026-10-02 11:50:44.277111+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | audit trail |
| `public.cash_movements` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.categories` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.checkout_requests` | 1 | 2026-10-02 11:50:35.655717+00 | 2026-10-02 11:50:35.655717+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | sales/financial workflow |
| `public.customer_display_sessions` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.customer_segment_memberships` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.customer_segments` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.customers` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.dining_options` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.discounts` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.employee_invitations` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | workforce/access or device configuration |
| `public.employee_roles` | 1 | 2026-09-23 02:32:58.105209+00 | 2026-09-23 02:32:58.105209+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | workforce/access or device configuration |
| `public.employee_stores` | 1 | 2026-09-23 02:32:58.105209+00 | 2026-09-23 02:32:58.105209+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | workforce/access or device configuration |
| `public.employees` | 1 | 2026-09-23 02:32:58.105209+00 | 2026-09-23 02:32:58.105209+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | workforce/access or device configuration |
| `public.goods_receipt_lines` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | sales/financial workflow |
| `public.goods_receipts` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | sales/financial workflow |
| `public.inventory_adjustment_import_batches` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.inventory_adjustment_reasons` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.inventory_adjustments` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.inventory_count_batch_documents` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.inventory_count_batches` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.inventory_count_lines` | 2 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.inventory_counts` | 2 | 2026-10-02 11:50:30.528938+00 | 2026-10-02 11:50:44.280404+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.inventory_levels` | 1 | 2026-10-02 11:50:44.277111+00 | 2026-10-02 11:50:44.277111+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.inventory_movements` | 4 | 2026-10-02 11:50:30.507785+00 | 2026-10-02 11:50:44.277111+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.inventory_policies` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.inventory_policy_defaults` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.inventory_replenishment_rules` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.kitchen_order_items` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.kitchen_orders` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.kitchen_station_category_routes` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.loyalty_card_events` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.loyalty_cards` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.loyalty_programs` | 1 | 2026-09-23 02:32:58.105209+00 | 2026-09-23 02:32:58.105209+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.loyalty_transactions` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.modifier_groups` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.modifier_options` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.offline_sync_events` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.open_tickets` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.organization_export_sessions` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant configuration |
| `public.organization_features` | 14 | 2026-09-23 02:32:58.105209+00 | 2026-09-23 02:32:58.105209+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant configuration |
| `public.organization_rate_limit_windows` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant configuration |
| `public.organization_usage_daily` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant configuration |
| `public.payment_methods` | 6 | 2026-09-23 02:32:58.105209+00 | 2026-09-23 02:32:58.105209+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | sales/financial workflow |
| `public.payments` | 1 | 2026-10-02 11:50:35.655717+00 | 2026-10-02 11:50:35.655717+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | sales/financial workflow |
| `public.pos_device_sequence_receipts` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | sales/financial workflow |
| `public.pos_device_sync_checkpoints` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | workforce/access or device configuration |
| `public.pos_device_sync_telemetry` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | workforce/access or device configuration |
| `public.pos_devices` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | workforce/access or device configuration |
| `public.pos_favorite_tiles` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.pos_sync_changes` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.product_components` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.product_modifier_groups` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.product_store_settings` | 1 | 2026-09-24 11:01:08.69393+00 | 2026-09-24 11:01:08.69393+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.product_units` | 1 | 2026-09-24 11:01:08.69393+00 | 2026-09-24 11:01:08.69393+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.product_variants` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.production_run_components` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.production_runs` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.products` | 1 | 2026-09-24 11:01:08.69393+00 | 2026-09-24 11:01:08.69393+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.purchase_order_lines` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.purchase_orders` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.receipt_delivery_requests` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | sales/financial workflow |
| `public.receipt_settings` | 1 | 2026-09-23 02:32:58.105209+00 | 2026-09-23 02:32:58.105209+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | sales/financial workflow |
| `public.receipts` | 1 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | sales/financial workflow |
| `public.refund_items` | 1 | 2026-10-02 11:50:37.541975+00 | 2026-10-02 11:50:37.541975+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | sales/financial workflow |
| `public.refund_payments` | 1 | 2026-10-02 11:50:37.541975+00 | 2026-10-02 11:50:37.541975+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | sales/financial workflow |
| `public.refund_requests` | 1 | 2026-10-02 11:50:37.541975+00 | 2026-10-02 11:50:37.541975+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | sales/financial workflow |
| `public.refunds` | 1 | 2026-10-02 11:50:37.541975+00 | 2026-10-02 11:50:37.541975+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | sales/financial workflow |
| `public.registers` | 1 | 2026-09-23 02:32:58.105209+00 | 2026-09-23 02:32:58.105209+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | workforce/access or device configuration |
| `public.role_permissions` | 193 | 2026-09-23 02:32:58.105209+00 | 2026-09-23 02:32:58.105209+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | workforce/access or device configuration |
| `public.roles` | 5 | 2026-09-23 02:32:58.105209+00 | 2026-09-23 02:32:58.105209+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | workforce/access or device configuration |
| `public.sale_exchanges` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | sales/financial workflow |
| `public.sale_items` | 1 | 2026-10-02 11:50:35.655717+00 | 2026-10-02 11:50:35.655717+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | sales/financial workflow |
| `public.sales` | 1 | 2026-10-02 11:50:35.655717+00 | 2026-10-02 11:50:35.655717+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | sales/financial workflow |
| `public.shifts` | 1 | 2026-09-24 10:54:18.513506+00 | 2026-09-24 10:54:18.513506+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | workforce/access or device configuration |
| `public.smart_menu_categories` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.smart_menu_products` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.smart_menus` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.stock_request_discrepancies` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.stock_request_lines` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.stock_requests` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.stock_transfer_lines` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.stock_transfer_receipt_lines` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | sales/financial workflow |
| `public.stock_transfer_receipts` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | sales/financial workflow |
| `public.stock_transfers` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.store_payment_methods` | 6 | 2026-09-23 02:32:58.105209+00 | 2026-09-23 02:32:58.105209+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | sales/financial workflow |
| `public.stores` | 1 | 2026-09-23 02:32:58.105209+00 | 2026-09-23 02:32:58.105209+00 | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant configuration |
| `public.supplier_return_lines` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.supplier_returns` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.suppliers` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | catalog or inventory workflow |
| `public.supply_chain_warehouses` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.tax_rates` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.ticket_templates` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |
| `public.time_clock_entries` | 0 | — | — | direct `organization_id → organizations.id`; ON DELETE RESTRICT | tenant-scoped application record |

## Indirect and identity dependencies

| Table / relationship | Rows | Relationship and delete behavior | Decision |
| --- | ---: | --- | --- |
| `public.profiles` | 1 | Certification employee `profile_id`; profile is cross-tenant identity data rather than a tenant-keyed row. | Preserve pending separate identity decision. |
| `private.identity_links` | 1 | Supabase provider subject maps to the certification profile. | Preserve; do not delete Auth identity under this packet. |
| `private.employee_pin_credentials` | 0 | `employee_id` FK cascades; `updated_by_employee_id` restricts. | Recheck at execution; no rows now. |
| `private.pos_device_credentials` | 0 | `device_id` FK cascades. | Recheck at execution; no rows now. |
| `organizations.archive_requested_by_employee_id` | 0 reference | The certification organization’s archive-request actor is NULL. | No self-reference blocker. |

## Auth identity safety

- Certification employee profiles: 1.
- Linked Supabase identity links: 1 (provider `supabase`).
- Matching Supabase `auth.users` row: 1.
- Other-organization employee memberships for that profile: 0.
- Shared Auth identity with another organization: **NO**.
- Auth deletion decision: **not authorized and not included in any future tenant-delete transaction**.

## Required deletion transaction — design only, DO NOT EXECUTE

This is an approval gate, not executable SQL. Before any destructive action, repeat the exact ID/name assertion, recompute the artifact fingerprint, regenerate the live FK graph, and abort on any count, FK, or source-of-truth mismatch.

1. Begin one transaction and lock the target organization row. Assert its name, ID, and every expected table count above.
2. Delete non-zero child leaves before their parents: refund/payment/request lines; sale lines, receipts, checkout requests, and sales; inventory count lines/counts/movements/levels; product settings/units before products; role/store/employee join rows before their parents; and all tenant configuration/audit records.
3. Re-evaluate every `ON DELETE RESTRICT` FK after each stage. Delete only rows belonging to the exact organization ID; never use an unscoped cascade or `DELETE FROM organizations` shortcut.
4. Delete remaining direct tenant-keyed parents in catalog-derived topological order, including registers, employees, roles, payment methods, stores, and organization configuration, while preserving `public.profiles`, `private.identity_links`, and Supabase `auth.users`.
5. Assert zero rows for all 103 direct tenant-keyed tables and zero indirect credential rows. Run orphan and cross-tenant checks. Roll back on any mismatch.
6. Only then remove the organization row and re-run the zero-orphan checks before committing.

## Approval state

**DESTRUCTIVE TENANT CLEANUP APPROVAL REQUIRED**

No deletion plan in this file is authorization to execute it.
