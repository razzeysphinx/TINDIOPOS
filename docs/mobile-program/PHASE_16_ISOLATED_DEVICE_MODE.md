# Phase 16 — Isolated Device Mode

## Implementation status

**IMPLEMENTATION COMPLETE**

## Certification status

**VALIDATING**

Full runtime certification remains deferred by the user.

## Goal

Allow an enrolled native POS to preserve safe permitted operation when both:

```text
cloud unavailable
+
Store Hub unavailable
```

Each isolated device continues through:

```text
SQLite
+
Durable outbox
+
Local runtime
```

## Connection states

TINDIO now models:

```text
CLOUD_ONLINE
STORE_LOCAL
DEVICE_ISOLATED
RECOVERING
SYNC_REVIEW
```

## Recovery path

Locked recovery behavior:

```text
DEVICE_ISOLATED
↓
STORE_LOCAL
↓
RECOVERING
↓
CLOUD_ONLINE
```

When peer/local coordination is not available, the device may recover directly from `DEVICE_ISOLATED` into `RECOVERING` when cloud connectivity returns.

TINDIO does not report `CLOUD_ONLINE` immediately after connectivity returns.

It first runs reconciliation.

## CLOUD_ONLINE gate

`CLOUD_ONLINE` requires:

- cloud business context reachable
- durable outbox reconciliation
- no remaining server delta pages
- no pending outbox events
- no syncing outbox events
- no failed outbox events
- no conflict outbox events

If durable events require operator attention:

```text
SYNC_REVIEW
```

If synchronization is incomplete but retryable:

```text
RECOVERING
```

## Transaction custody protection

Unresolved durable transactions block:

- sign out
- organization switching
- Store Hub removal

This prevents local transactions from being stranded by context-changing actions.

## Idempotency

Existing durable sale identity is preserved.

Offline sales continue to use stable:

- event ID
- idempotency key
- device sequence
- local receipt reference

Recovery reuses the existing durable outbox and server idempotency handling.

## Data safety

Phase 16 does not:

- delete unresolved outbox events
- overwrite authoritative stock
- treat Store Hub ACK as cloud ACK
- expand the durable outbox operation type set
- create a second mobile business engine

## Offline authorization

Isolated mutation capability continues to depend on the existing offline authorization grant, cached business/store/register/device identity, active cached shift, reference snapshot, and complete cached catalog.

If that authorization expires, the device may retain/recover its durable transactions but may not silently continue unauthorized offline mutation.

## Diagnostics

Native Sync Status exposes:

- persisted connection mode
- mode transition time
- unresolved transaction count
- pending/syncing/conflict/failed counts
- oldest unresolved local reference
- device sequence
- server checkpoint
- pull cursor
- last reconciliation
- offline authorization state
- cloud-online recovery safety

## Database impact

Server DB migration:

```text
NONE
```

Additional local SQLite schema migration:

```text
NONE
```

Phase 16 reuses the Phase 15 local schema.

## Certification still required later

- app kill while isolated
- phone reboot while isolated
- multiple isolated cash sales
- Store Hub disappearance
- Store Hub return
- cloud return without Hub
- cloud return after Store Local operation
- missing ACK
- duplicate retry
- conflict creation
- failed authorization
- offline authorization expiry
- organization switch protection
- sign-out protection
- deterministic cloud recovery
- Android runtime testing
- Phase 08–16 certification sweep

## Phase status

```text
PHASE 16
IMPLEMENTATION COMPLETE
STATUS: VALIDATING
CERTIFICATION: DEFERRED
```

Next canonical phase after ChatGPT review:

```text
PHASE 17 — SYNC CONTROL CENTER 2.0
```
