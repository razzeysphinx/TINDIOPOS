# Phase 26 — Production Observability

## Source-of-Truth gate

```text
Operational problems can be detected before they become silent business failures.
```

## Monitored health

Phase 26 exposes application-crash count/rate, active-JavaScript responsiveness stalls, API average and maximum latency, API failures, sync latency, queue depth, failures, conflicts, app version, offline duration, device heartbeat, checkpoint gap, local SQLite health/schema version, and a tenant-scoped server database probe.

## Existing architecture reused

Phase 26 extends Phase 17 sync telemetry, Phase 22 performance metrics, the Phase 23 root crash boundary, Phase 25 fleet management, and the existing local SQLite health system. No second telemetry pipeline is created.

## Privacy

Crash and responsiveness telemetry records only aggregate counts and timestamps. API and sync telemetry record aggregate latency/failure numbers only. Alert diagnostics are constructed by the server from an explicit aggregate-field allowlist. Transaction content, customer content, payment content, credentials, exception messages, and stack traces are excluded.

## Attention rules

`ATTENTION REQUIRED` covers active terminals with SYNC_REVIEW, conflicts, failures, unavailable local DB, stale heartbeat, or a checkpoint gap with pending queue. `CHECK REQUIRED` covers pending/offline state, stale heartbeat, latency/failure signals, local DB checks, and recorded crashes. These signals never mutate transactions.

The existing telemetry RPC evaluates four routed alert classes: `APP_CRASH`, `ANR`, `API_OUTAGE`, and `STALE_QUEUE`. Each alert is assigned to an active named employee with `devices.manage`, points to `Back Office > Production Observability`, carries an operator-facing runbook, and can be acknowledged only through the tenant-scoped manager RPC. API-outage and stale-queue alerts resolve automatically after recovered telemetry; historical alert evidence is retained.

## Database impact

Original server migration: `20260929230000_phase_26_production_observability.sql`

A45 hardening migration: `database/migrations/0019_mobile_a45_operational_alerts.sql`

Tenant isolation is preserved and telemetry writes remain RPC-only.

SQLite migration: `NONE` — crash state uses existing local metadata storage.

## Certification

```text
PHASE 26
IMPLEMENTATION COMPLETE
STATUS: VALIDATING
CERTIFICATION: NOT CERTIFIED
```

The A45 synthetic authenticated runtime proves server routing, sanitization, acknowledgement, and recovery. It does not prove a native Android process crash or operating-system ANR. Physical Android injection plus pilot/production operation remains required to certify alert effectiveness.
