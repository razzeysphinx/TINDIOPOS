# Phase 26 — Production Observability

## Source-of-Truth gate

```text
Operational problems can be detected before they become silent business failures.
```

## Monitored health

Phase 26 exposes crash count/rate, API average and maximum latency, API failures, sync latency, queue depth, failures, conflicts, app version, offline duration, device heartbeat, checkpoint gap, local SQLite health/schema version, and a tenant-scoped server database probe.

## Existing architecture reused

Phase 26 extends Phase 17 sync telemetry, Phase 22 performance metrics, the Phase 23 root crash boundary, Phase 25 fleet management, and the existing local SQLite health system. No second telemetry pipeline is created.

## Privacy

Crash telemetry records only aggregate count, observation-window start, and last-crash timestamp. API and sync telemetry record aggregate latency/failure numbers only. Transaction content, customer content, payment content, credentials, and exception diagnostics are excluded.

## Attention rules

`ATTENTION REQUIRED` covers active terminals with SYNC_REVIEW, conflicts, failures, unavailable local DB, stale heartbeat, or a checkpoint gap with pending queue. `CHECK REQUIRED` covers pending/offline state, stale heartbeat, latency/failure signals, local DB checks, and recorded crashes. These signals never mutate transactions.

## Database impact

Server migration: `20260929230000_phase_26_production_observability.sql`

Tenant isolation is preserved and telemetry writes remain RPC-only.

SQLite migration: `NONE` — crash state uses existing local metadata storage.

## Certification

```text
PHASE 26
IMPLEMENTATION COMPLETE
STATUS: VALIDATING
CERTIFICATION: NOT CERTIFIED
```

Real pilot/production operation is required to certify alert effectiveness.
