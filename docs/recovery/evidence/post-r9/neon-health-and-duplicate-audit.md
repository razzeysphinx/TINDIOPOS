# Post-R9 Canonical Neon Health and Duplicate-Object Audit

Status: **READ-ONLY AUDIT COMPLETE**

Audited target: Neon project `divine-sound-41148108`, branch
`br-snowy-heart-b5nf6q3n` (`r6-clean-canonical-20261002`), database
`tindio_r6_recovery`.

The audit used only read-only SQL. The live target reported PostgreSQL 18.6,
100 public tables, 7 private tables, 149 policies, 104 RLS-enabled tables,
206 triggers, 466 functions, zero unvalidated foreign keys, and zero invalid
indexes.

## Semantic duplicate results

| Candidate type | Result | Disposition |
| --- | --- | --- |
| Indexes | No equivalent duplicate index signatures | No action |
| Functions | No duplicate schema/name/signature definitions | No action |
| Policies | No equivalent policy predicates | No action |
| Triggers | No equivalent trigger definitions | No action |
| Tables | No same-purpose duplicate table candidate identified | No action |

## Organization-row candidates

Two active organizations are present. `RAZZEY TRADING CORP.` is the live
business organization. `TINDIO Phase 04 Certification`
(`baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9`) is a non-authoritative certification
fixture with dependent sales, refunds, receipts, inventory counts/movements,
roles, and bootstrap reference rows.

It is **not safe to remove automatically**. Any removal requires a separately
approved, dependency-aware destructive plan that names this organization and
its dependent records exactly. No row was changed by this audit.

## Realtime hardening follow-through

Forward migration `0012_provider_neutral_realtime_dispatch.sql` replaces the
provider-coupled kitchen trigger body with a private TINDIO-owned,
tenant/store-scoped outbox. It is not yet applied to this live branch by this
repository hardening work. The migration was certified on the disposable local
canonical install; the immutable baseline remains unchanged.
