# MOB-10 Slice 24 — A50 isolated cloud-backup restore

## Phase and ticket

```text
Mobile Phases 05 and 26
MOB-10 Slice 24
A50 — Cloud backup restore in isolated environment
```

## Starting commit

```text
e97e82727f5bab3183e24e1c5357cbd977d64221
```

## Observed gap

The repository had a destructive-operation-safe local Postgres restore drill and historical R6–R9 migration evidence, but A50 lacked a current cloud recovery rehearsal from the authoritative Neon branch. The business backup runbook also still described Supabase as the business-database recovery platform even though Supabase now provides Auth and Neon is authoritative for business data.

## Architecture decision

Use Neon's branch-first recovery model. Create one expiring, read-only, copy-on-write branch directly from the exact canonical production branch and reconcile it without changing production routing or application environment variables. This is logically equivalent to an isolated restored database state under Neon's architecture.

The branch was created with minimum compute, the account's permitted suspend policy, a 24-hour expiration, and a separate endpoint. The first request attempted an explicit suspend interval and was rejected with HTTP 412 before creation because the current account cannot override that setting. The successful request omitted only that unsupported override.

## Exact cloud targets

```text
Canonical project: divine-sound-41148108
Canonical branch: br-snowy-heart-b5nf6q3n
Canonical database: tindio_r6_recovery
Canonical primary/default after drill: true / true

Recovery branch: br-mute-queen-b5xvyxra
Recovery name: a50-isolated-restore-20261015-114144
Recovery parent: br-snowy-heart-b5nf6q3n
Recovery parent LSN: 0/5A91D58
Recovery point: 2026-10-15T06:54:52Z
Recovery endpoint type: read_only
Recovery primary/default: false / false
Recovery written bytes: 0
Recovery expiration: 2026-10-16T11:41:44Z
```

The historical `noisy-violet-27747237` project was not queried or modified. No non-authoritative R6/R9 certification branch was used as the source; the named former R6 target is now the explicitly locked canonical production branch.

## Reconciliation result

```text
A50: PASS
Recovery time: 82.329 seconds
Selected recovery-point age: 17,212.137 seconds
Observed data loss: 0 rows (exact source match)
Protected tables fingerprinted: 21
Exact table fingerprints: PASS
Financial totals: PASS
Inventory totals: PASS
Financial/stock/device relationship checks: 17/17 zero
Canonical writes: 0
Recovery-branch writes: 0
Raw business rows persisted in evidence: false
```

The protected set covers organizations, stores, registers, products/variants, shifts, sales and sale items, payments, receipts, refunds and refund lines/payments, idempotency request records, inventory levels/movements, POS devices, device-sequence receipts, server checkpoints, and shift-custody leases.

Recovered totals matched the canonical recovery point exactly:

```text
Sales: 1,113 / 111,300 minor units
Payments: 1,113 / 111,300 minor units
Receipts: 1,113
Refunds: 1 / 100 minor units
Refund payments: 100 minor units
Inventory movements: 1,118
Inventory quantity: 98
Device sequence receipts: 1,111
```

Relationship checks proved zero missing financial parents, zero tenant/store/shift scope mismatch, zero invalid inventory movement math, zero missing sale/refund movement source, and zero orphan device sequence/checkpoint/custody records.

## Changed files

- guarded live A50 reconciliation harness;
- A50 behavioral/source-contract tests and package commands;
- Neon-authoritative backup/recovery governance correction;
- this closure report and structured evidence.

## Database, SQLite, and API compatibility

```text
Canonical Neon writes: NONE
Canonical schema migration: NONE
Recovery branch writes: NONE
SQLite migration/reset: NONE
POS v2 API change: NONE
Supabase Auth change: NONE
Application environment change: NONE
Production endpoint/cutover change: NONE
```

## Security and transaction-custody impact

- Both database inspections ran with transaction-level read-only enforcement.
- The restore harness rejects the historical/non-canonical source, pooled endpoints, the canonical endpoint as a restore target, an unexpected database, and a recovery branch without the expected prefix/parent.
- Evidence stores counts and SHA-256 fingerprints, not business rows, secrets, credentials, or customer information.
- Device sequences, checkpoints, and unresolved shift custody were fingerprinted and relationship-checked.
- No local app database, outbox event, checkout intent, receipt, credential, or recovery record was changed.

## Tests and exact results

```text
pnpm test:mobile-a50-cloud-restore
PASS — 4 tests, 0 failures

pnpm certify:mobile-a50-live
PASS — 21 exact protected-table fingerprints; 17/17 relationship checks zero

pnpm typecheck
PASS

pnpm mobile:typecheck
PASS

pnpm lint
PASS — 0 errors, 3 pre-existing warnings

pnpm --dir apps/mobile lint
PASS — 0 errors, 1 pre-existing warning

pnpm test:canonical-production-neon-target
PASS — 2 tests, 0 failures

pnpm test:recovery:neon-r9
PASS — 213 immutable historical migrations verified

pnpm certify:static
155/157 package commands PASS — phase-14 local restore and phase-04 Docker source connectivity could not run because the local Supabase source is unavailable

git diff --check
PASS
```

## Remaining limitations

- The project reports a 21,600-second history-retention window. Neon mapped the branch's parent LSN to a point 17,212.137 seconds before the request, but the canonical source had no later differing rows: all fingerprints matched and observed data loss was zero. The 17,212.137-second value is the age of the selected state, not a claim of lost transactions.
- This rehearsal verifies database recovery only. Supabase Auth, external object storage, secrets, Vercel configuration, hardware, and Android local-only transactions require their own recovery controls.
- The expiring branch is retained only until its automatic expiration so the evidence can be independently inspected. No manual deletion was performed.
- A47–A49 and hardware-dependent MOB-10 cases retain their previously reported status. A48 remains `NOT_RUN` until the real production-signed release candidate exists.

## Next smallest safe slice

MOB-10's independently executable acceptance cases are complete. Resume the blocked physical/external evidence cases when their hardware, legal/contact details, reviewer credentials, trusted Store Hub environment, and production release candidate are available. Do not mark the Android application production-ready until those gates pass.

The preserved blocker statuses, reopening conditions, first-release scope
constraints, and transition to MOB-11 are recorded in
`MOB_10_DEFERRED_EVIDENCE_REGISTER.md`.
