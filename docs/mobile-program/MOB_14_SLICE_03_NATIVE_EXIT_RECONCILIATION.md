# MOB-14 Slice 03 — Native crash and ANR reconciliation hardening

## Outcome

The post-audit A45 implementation already covers Android native crashes, Java
and startup process crashes, Android ANRs, sanitized routing and custody
preservation. Physical API-34 evidence is recorded in
`MOB_10_SLICE_20_A45_OPERATIONAL_ALERTS.md`.

This slice closes one remaining reconciliation defect: the installed code used
only the greatest Android exit wall-clock timestamp as its deduplication key.
After a device clock rollback, a genuinely new crash or ANR with an earlier
timestamp was silently ignored.

## Starting point and gap matrix

- Branch: `TINDIO-PREPRODUCTION`
- Starting commit: `ed0b50e08a3fb6d89cf0933017e3e011c712e480`

| Decision | Area | Result |
|---|---|---|
| KEEP | Android `ApplicationExitInfo` observer | It covers native crash, Java/startup crash and ANR classes on the certified Android target. |
| KEEP + HARDEN | Local exit reconciliation | Replace watermark-only deduplication with bounded type/timestamp fingerprints. |
| EXTEND | Installed-state reader | Safely defaults the new fields for existing devices. |
| REFACTOR | Reconciliation reducer | Extract deterministic pure logic for behavioral testing. |
| REPLACE | Watermark-only acceptance rule | The watermark remains for migration, but no longer suppresses post-migration rollback events. |
| REMOVE | None | No observer, alert or custody behavior is removed. |
| NEW | MOB-14 reconciliation suite | Tests normal exits, rollback, migration, malformed data, deduplication and bounded storage. |

## Architecture and compatibility

Each processed native event stores only `type:timestamp` in existing local
metadata. The ledger is capped at 64 fingerprints; Android supplies at most 32
historical exits per query. No descriptions, traces, exception messages,
customer data, payment data or transaction payloads are stored.

On the first run after upgrading, the existing watermark seeds fingerprints
for already-observed history without incrementing counters. After migration,
an unseen fingerprint is counted even if its timestamp is older than the
watermark. The watermark never moves backward.

- Database migration: none.
- SQLite schema migration: none; existing metadata storage is reused.
- HTTP/API compatibility: unchanged.
- Tenant/store authorization: unchanged.
- Transaction custody: untouched. Outbox events, checkout intents, receipts,
  recovery records, sequences, cursors and credentials are not read or mutated.

## Acceptance mapping

- A45 remains PASS based on the existing physical native crash/ANR and
  canonical-Neon routing evidence.
- This source slice adds deterministic evidence that new exits cannot be
  suppressed by wall-clock rollback or duplicated on repeated reconciliation.
- A48 remains NOT_RUN; no AAB was built or submitted.

## Validation

- `pnpm test:mobile-mob-14-crash-reconciliation`: PASS, 6/6.
- `pnpm test:mobile-a45-operational-alerts`: PASS, 6/6.
- `pnpm test:phase-26-observability`: PASS, 6/6.
- `pnpm test:phase-23-android-hardening`: PASS, 6/6.
- `pnpm typecheck`: PASS.
- `pnpm mobile:typecheck`: PASS.
- `pnpm lint`: PASS with 0 errors and 3 pre-existing warnings.
- `pnpm mobile:export:android`: PASS, 1,453 modules.
- `pnpm certify:static`: 162/164 automated package commands passed. The
  unchanged environment-dependent `test:phase-14-final-recovery` and
  `test:phase-04-docker-source-connectivity` checks failed because the local
  Supabase source is unavailable.
- `git diff --check`: PASS.

No new physical injection was needed: this slice changes deterministic local
reconciliation only. The existing API-34 native-crash/ANR physical evidence
remains applicable; release-candidate physical evidence remains outstanding.

## Remaining MOB-14 work

Complete the final alert/runbook closure audit, including API retry/byte metric
correctness, named ownership, escalation, acknowledgement and injected-incident
evidence. Do not duplicate the already-certified A45 routing architecture.
