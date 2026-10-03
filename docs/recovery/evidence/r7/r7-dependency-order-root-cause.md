# R7 Active-Organization Dependency-Order Root Cause

Status: **PROVEN**

The earlier suspended-organization hypothesis was false. Read-only source evidence shows two active organizations and no suspended organization.

The first failed guarded table was `public.employees`. PostgreSQL's data-only dump order was:

```text
public.profiles
public.employees
private.employee_pin_credentials
private.identity_links
public.organizations
```

`private.assert_organization_operational()` requires the inserted row's `organization_id` to resolve to an existing `public.organizations` row with `status = 'active'`. The employee COPY therefore failed because its organization had not yet been inserted in the same restore transaction. The error text covers both absent and non-operational organizations, which caused the initial false diagnosis.

The organization table cannot simply be placed first: `public.organizations.created_by` references `public.profiles.id`. The corrected root stage is therefore:

```text
public.profiles
→ public.organizations
→ commit and exact ID/status visibility gate
→ remaining dependency-ordered business dump
```

All 78 non-internal operational guards remain enabled. R7 tooling now discovers guarded tables from target trigger metadata, adds the semantic dependency on `public.organizations`, asserts organization-before-guarded ordering before writes, and uses a stage barrier. This mechanism is reusable for R8 and disaster recovery.

The first Stage 1 retry also proved that organization creation intentionally bootstraps governance, approval, loyalty, feature, payment, receipt, and sync-change rows. The Stage 2 transaction rolled back on the first duplicate. The resumable migrator now recognizes only that exact Stage-1 checkpoint, removes those generated target defaults while the active parents are visible, clears generated sync-change notifications, and replaces the defaults with the authoritative historical source rows. Any row outside the allowlisted checkpoint fails closed.

The next retry exposed a second semantic trigger dependency: inserting `public.roles` calls `private.grant_system_role_attendance_capability()`, which requires `public.permissions.permission_code = 'attendance.use'`. The corrected reference stage is `permissions → roles`; generated default role-permission rows are then removed before importing the authoritative historical `role_permissions` set.

A further retry exposed catalog bootstrap semantics: product insertion creates the default `each` unit, and the canonical unit-identity guard correctly prevents deleting a base unit. The catalog-root stage therefore reconciles that generated row in place to the authoritative source UUID and historical metadata while preserving its immutable organization, product, base flag, unit code, and conversion factor. Non-base source units are inserted normally. No trigger is disabled or modified.

The remaining business restore can also regenerate preset role grants before the historical role-permission section. `role_permissions` is therefore a final RBAC stage: all bootstrap triggers finish, generated grants are removed, and the authoritative historical grant set is imported once.
