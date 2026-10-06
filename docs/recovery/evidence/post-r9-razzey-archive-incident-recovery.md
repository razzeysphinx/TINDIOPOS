# Post-R9 RAZZEY archive-incident recovery attestation

**Completed:** 2026-10-06
**Authorization:** Explicit user approval for the guarded recovery of RAZZEY
TRADING CORP. only.
**Scope:** Restore the mistakenly archived RAZZEY organization to active without
altering its business history or the TINDIO Phase 04 Certification tenant.

## Canonical authority and the false preflight

The recovery was executed only through the Neon control plane against:

```text
project:  divine-sound-41148108
branch:   br-snowy-heart-b5nf6q3n (r6-clean-canonical-20261002)
database: tindio_r6_recovery
```

The session proved `current_database() = tindio_r6_recovery` before the
preflight and repair.

An earlier configured direct connection resolved to the retained historical
source `noisy-violet-27747237 / br-dawn-bar-ayd8jk76 / neondb`. That check was
read-only, showed pre-cutover/stale lifecycle data, and was stopped before any
mutation. It was not a canonical-production preflight. Old-source writes during
this recovery: **0**. The old source remains retained and non-authoritative;
its control-plane identity was re-confirmed without synchronizing or changing
it.

## Canonical before-image and preflight

The canonical RAZZEY row was exactly the approved before-image:

```text
organization:                    82643062-7d18-4f5a-b6a6-fc5da64bd810
name:                            RAZZEY TRADING CORP.
status:                          archived
archived_at:                     2026-10-05T14:35:49.375768Z
archive_requested_at:            2026-10-05T14:34:56.755268Z
archive_requested_by_employee:   d127d9eb-1fd7-466b-a413-c7424df277dd
```

The original archive-requested, export-prepared, export-delivered, and archived
audit records were present. Both delivered export sessions were present; their
combined fingerprint was `5bcde273dcb509d5e35e0785b09bcbe1`.

The protected certification tenant
`baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9` was active with no archive request or
archive timestamp. Its protected organization-row fingerprint was
`550f18c222006cc6d679a06b7e64f652`.

The RAZZEY owner/member profile and its lifecycle permissions remained active.
All checked business-table row-count/fingerprint pairs were captured before the
repair. The generic lifecycle and export-guard function definitions were also
fingerprinted before the repair.

## Guarded dry run

The exact row-locked correction and incident-audit insertion ran in a nested
PostgreSQL transaction and was deliberately rolled back. The dry run proved:

- exactly one RAZZEY organization row would change;
- the protected certification tenant would not change;
- RAZZEY would become active with every archive field cleared;
- one recovery audit record would be appended; and
- after rollback, the archived before-image and the seven original RAZZEY audit
  records were restored exactly, with no recovery audit record persisted.

## Committed canonical correction

The identical guarded statement then committed. It changed only the RAZZEY
organization lifecycle metadata from `archived` to `active`, cleared the three
archive fields, and appended one audit record:

```text
event:     ORGANIZATION_ARCHIVE_INCIDENT_RECOVERED
operation: organization.recovery
audit id:  f7866efc-5dba-4794-85be-e6eb41894b6a
actor:     NULL (incident-recovery system audit)
```

The audit records the original archive values, the protected certification
tenant ID, explicit authorization, and PR #39 merge
`d549e1c3a7a98bbe3f3977cc37bee201c945be2c`.

## Post-repair proof

RAZZEY now resolves as active, with `archived_at`, `archive_requested_at`, and
`archive_requested_by_employee_id` all `NULL`. Its authorized owner/profile
mapping remains intact.

The original archive/export audit-event counts remain intact, the two export
sessions retain the same fingerprint, and one (and only one) recovery audit
event is present. All **99** checked non-audit tenant tables match their
pre-repair counts and fingerprints (`0` mismatches). This includes sales,
payments, receipts, refunds, inventory movements, inventory counts and lines,
catalog, purchasing, stock requests/transfers, shifts, roles, and settings.

The certification tenant still has the pre-repair fingerprint
`550f18c222006cc6d679a06b7e64f652`, remains active and unarchived, and received
no update. The following function-definition fingerprints are unchanged:

```text
private.assert_archive_export_delivered  fc7440b3d0bc88c0529718240ca6bd7a
private.write_audit_log                  60e57fc6c7dd1356ea658dd56f425089
public.manage_organization_lifecycle     ab30a7fb0d7a35ff8653173d9c1c1882
public.prepare_organization_export       01dbbf8f946290351982459c6a17c437
```

No generic `UNARCHIVE` capability, RLS change, trigger change, guard bypass,
business-data mutation, tenant deletion, or Auth change was introduced.
