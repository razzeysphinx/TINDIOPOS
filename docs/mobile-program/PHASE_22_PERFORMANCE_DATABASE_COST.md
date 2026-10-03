# Phase 22 — Performance + Database Cost Certification

## Source-of-Truth gate

```text
Operational cost and performance characteristics are understood.
```

## Implementation

Phase 22 adds measurement capability for:

- API call rate
- API retry/failure count
- API latency
- reported response bytes
- SQLite search latency
- SQLite rows returned
- sync duration
- sync throughput
- recovery duration
- Realtime connection count

Database cost snapshots measure:

- PostgreSQL transaction counters
- block reads/hits
- returned/fetched rows
- inserted/updated/deleted rows
- table sequential scans
- sequential tuples read
- index scans
- index tuples fetched
- active/idle connections
- pg_stat_statements calls
- statement execution time
- statement rows

## Existing profiler reuse

Phase 22 retains and may reuse:

```text
scripts/phase-05-neon-runtime-profile.mjs
```

The Phase 05 profiler already measures:

- Neon database deltas
- query statements where available
- connection behavior
- endpoint latency
- Back Office page latency

## No speculative optimization

Phase 22 intentionally does not add indexes or caching from guesswork.

Optimization requires measured evidence.

## Realtime

Current native POS Realtime connections:

```text
0
```

No Realtime connection is added for performance monitoring.

## Security

Performance telemetry must not record:

- access tokens
- authorization headers
- device secrets
- customer transaction payloads
- card/payment credentials

## Database migration

```text
NONE
```

## SQLite migration

```text
NONE
```

## Status

After instrumentation and static/build validation:

```text
PHASE 22
IMPLEMENTATION COMPLETE
STATUS: VALIDATING
CERTIFICATION: NOT CERTIFIED
```

Certification requires controlled runtime measurements from the Phase 22 runbook.

Next canonical phase:

```text
PHASE 23 — ANDROID PRODUCTION HARDENING
```