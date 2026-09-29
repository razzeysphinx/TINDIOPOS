# Phase 14 â€” Offline Inventory Intelligence

## Status

IMPLEMENTING

## Slice plan

- Slice 01 â€” honest local inventory read model
- Slice 02 â€” cart-wide/local activity integration and stale-baseline handling
- Slice 03 â€” sync-status visibility, hardening, documentation, deferred certification handoff

## Slice 01

Implemented inventory intelligence distinguishes:

1. last confirmed cloud stock
2. known synced sale activity from this terminal after the cloud baseline
3. device-only unresolved sale activity
4. estimated available stock

The estimate is explicitly:

```text
ESTIMATE ONLY
CURRENT DEVICE ONLY
NOT AUTHORITATIVE CLOUD STOCK
```

The authoritative inventory ledger remains server-side.

No direct stock mutation is performed by the device.

No server database migration is introduced.

No local SQLite schema migration is introduced.

The durable outbox remains:

```text
SALE_COMPLETED
```

Store-wide peer awareness is not claimed in Phase 14 Slice 01.
That belongs to later Store Hub work in Phase 15.

## Certification

Deferred until the dedicated certification sweep.

Phase 14 remains IMPLEMENTING after Slice 01.
