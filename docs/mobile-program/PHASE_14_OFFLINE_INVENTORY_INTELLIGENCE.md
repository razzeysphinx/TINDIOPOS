# Phase 14 â€” Offline Inventory Intelligence

## Implementation status

**IMPLEMENTATION COMPLETE**

## Certification status

**VALIDATING**

Full runtime certification remains deferred by the user.

## Goal

Provide useful but honest inventory intelligence when a native POS device is offline or operating from cached state.

## Implemented model

TINDIO now distinguishes:

1. **Last confirmed cloud stock**
2. **Known synced activity from this terminal after that baseline**
3. **Device-only unresolved sale activity**
4. **Estimated available stock**
5. **Current cart quantity**
6. **Projected stock after the current cart**
7. **Cloud baseline age**

## Scope disclosure

The local intelligence model is explicitly:

```text
ESTIMATE ONLY
CURRENT DEVICE ONLY
```

It does not claim to know unsynced activity from another isolated device.

That coordination problem belongs to:

```text
PHASE 15 â€” STORE LOCAL MODE / STORE HUB
```

## Authoritative inventory

The server inventory ledger remains authoritative.

The native client does not:

- overwrite central stock
- post local calculated stock as truth
- create direct stock adjustments from the estimate
- merge peer-device guesses into central inventory
- discard unresolved local sales

## Existing architecture reused

Phase 14 reuses:

- Phase 09 cached stock estimates
- Phase 10 durable `SALE_COMPLETED` outbox
- Phase 11 device identity and sequence
- Phase 12 sync/reconciliation state

## Database impact

Server database migration:

```text
NONE
```

Local SQLite migration:

```text
NONE
```

Current local schema remains version 6.

## Outbox impact

Durable outbox remains:

```text
SALE_COMPLETED
```

No new offline mutation type was introduced.

## Cashier behavior

The native POS can display for cart items:

- last confirmed cloud stock
- baseline age
- current-terminal synced activity after that baseline
- current-device unresolved activity
- estimated available stock
- current cart quantity
- projected available stock after the current cart
- local negative-stock warning

All displays identify the result as an estimate.

## Sync Status behavior

Sync Status exposes:

- number of cached cloud stock baselines
- oldest/newest baseline timestamps
- unresolved local sale count
- number of affected saleables on the current device
- server-ledger authority statement
- current-device-only scope statement

## Certification still required later

- real Android runtime behavior
- online â†’ offline transition
- cold-start offline behavior
- multiple queued offline sales
- ambiguous network failures
- post-sync baseline refresh behavior
- multiple-device isolation scenarios
- tenant/store isolation runtime checks
- full Phase 08â€“14 certification sweep

## Phase status

```text
PHASE 14
IMPLEMENTATION COMPLETE
STATUS: VALIDATING
CERTIFICATION: DEFERRED
```

Next canonical phase after ChatGPT review:

```text
PHASE 15 â€” STORE LOCAL MODE / STORE HUB
```
