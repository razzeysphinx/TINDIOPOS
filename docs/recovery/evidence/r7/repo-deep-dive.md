# TINDIO Neon Recovery R7 — Repository Deep-Dive

Status: **PASS — completed before any R7 data write**

## Repository and phase boundary

- Branch: `recovery/neon-canonical-rebuild`
- Starting local/remote HEAD: `2e0ef023cf0d90162485fd1e389c4a5b9c0042eb`
- R0–R6: complete; R7: execution phase; R8: not started.
- The sole pre-existing untracked file is the R4 handover. It remains excluded from R7 work.
- The 211 historical Supabase migrations and pushed canonical baseline/migrations are immutable inputs.

## Canonical installation and schema

- Canonical install is baseline `0001` plus forward migrations `0002`–`0010`, followed by the Neon roles and identity adapters.
- Baseline contains 100 public and 7 private tables; RLS, identity, and provider role adaptation are already R6-certified.
- Source has 96 public and 7 private tables. Target adds four offline/sync tables: `pos_device_sequence_receipts`, `pos_device_sync_checkpoints`, `pos_device_sync_telemetry`, and `pos_sync_changes`.
- Every source table and column exists unchanged on target. No source-only table, missing primary key, or unvalidated source FK was found.

## Source and target integration

- Authoritative source evidence converges on Neon project `noisy-violet-27747237`, branch `tindio-preproduction-phase-04`, database `neondb`: `.neon`, `.env.local`, `.env.phase-05b.local`, runtime provider `neon`, and the locked Source of Truth all identify the current Neon deployment as rollback/source-of-truth.
- The isolated R6 target is project `divine-sound-41148108`, branch `br-snowy-heart-b5nf6q3n` / `r6-clean-canonical-20261002`, database `tindio_r6_recovery`.
- Both endpoints are direct, non-pooled Neon connections and are host/database allowlisted by R7 tooling.
- Source SQL is executed only inside `BEGIN TRANSACTION READ ONLY` with `PGOPTIONS=-c default_transaction_read_only=on`. Source dumps use the same server-enforced default.

## Reused tooling and improvements

- Reused `scripts/lib/run-command.mjs`, the Docker PostgreSQL transport in `scripts/lib/phase-04-postgres-docker.mjs`, and the R6 explicit target identity pattern.
- Added a read-only SQL/dump mode to the shared PostgreSQL helper without changing existing call behavior.
- Added R7-specific census, classification, migration, and reconciliation tooling under `scripts/recovery/r7/`.
- The old Phase 04 migrator is not reused as an orchestrator: it blanket-copies schemas, encodes obsolete source assumptions, lacks per-table classification, and lacks R7 reconciliation.

## R3–R6 change review

- R3 moved business identity to `private.current_profile_id()` with provider adapters.
- R4 moved canonical policy/ACL targets to TINDIO-owned roles.
- R5 added read-model functions in migrations `0004`–`0010`; these are schema-only and do not alter the migration classification.
- R6 installed and certified the exact canonical chain into the isolated target with zero business rows.
- No R3–R6 file requires rewriting for R7.

## Initial census

- Shared source/target tables: 103.
- Source-only tables: 0.
- Target-only canonical tables: 4.
- Source rows across public/private: 561.
- Target rows before migration: 0.
- Source organizations: 2.

Machine-readable evidence is in `source-target-census.json`, `table-classification.json`, and `dependency-plan.json`.
