# Phase 17 — Sync Control Center 2.0

## Implementation status

**IMPLEMENTATION COMPLETE**

## Certification status

**VALIDATING**

Full runtime certification remains deferred by the user.

## Source-of-Truth goal

Upgrade the Back Office Sync Center so sync problems cannot silently remain invisible.

## Implemented device visibility

Sync Control Center 2.0 displays:

- organization-scoped terminal telemetry
- store
- register
- device
- employee
- connection mode
- app version
- last heartbeat
- last successful sync
- device checkpoint
- server checkpoint
- checkpoint gap
- queue depth
- conflict count
- failed count
- offline duration

## Connection modes

The center understands:

```text
CLOUD_ONLINE
STORE_LOCAL
DEVICE_ISOLATED
RECOVERING
SYNC_REVIEW
```

## Attention classification

Device health is visibly classified as:

```text
HEALTHY
CHECK REQUIRED
ATTENTION REQUIRED
```

Examples that surface attention:

- `SYNC_REVIEW`
- durable conflicts
- failed durable events
- unresolved queue depth
- recovering device
- stale heartbeat

This is observability, not automatic destructive repair.

## Existing offline-event review

The previous offline sale outcome/conflict review remains available below device health.

Existing durable event review behavior is preserved.

## Security

Back Office telemetry requires:

```text
devices.manage
```

and remains restricted by:

- organization context
- authorized Back Office store scope
- device identity
- device/store/register binding
- authenticated employee identity

## Telemetry minimization

The telemetry channel contains operational health only.

It does not send:

- sale payload JSON
- customer details
- payment details
- card data
- Store Hub token
- Supabase/cloud access token

## Authority

Telemetry is observational.

It does not:

- acknowledge a durable sale
- change outbox state
- change inventory
- replace device validation
- replace cloud reconciliation
- replace Store Hub coordination

## Database impact

Server migration:

```text
pos_device_sync_telemetry
```

No additional mobile SQLite schema migration is required.

## Certification still required later

- real Android heartbeat
- device disappears from network
- stale heartbeat classification
- cloud-online healthy terminal
- Store Local reported after reconnect
- isolated device reported after reconnect
- recovering device
- sync-review device
- queue/conflict/failed counts
- checkpoint gap display
- store filter isolation
- cross-tenant denial
- `devices.manage` denial
- telemetry outage does not break checkout
- Phase 08–17 certification sweep

## Phase status

```text
PHASE 17
IMPLEMENTATION COMPLETE
STATUS: VALIDATING
CERTIFICATION: DEFERRED
```

Next canonical phase after ChatGPT review:

```text
PHASE 18 — DISASTER RECOVERY + OFFLINE TORTURE TESTING
```
