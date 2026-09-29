# Phase 16 â€” Isolated Device Mode

## Status

IMPLEMENTING

## Goal

Allow an enrolled POS to continue safe permitted operation when:

```text
cloud unavailable
+
Store Hub unavailable
```

while protecting every durable transaction for later recovery.

## Slice plan

1. Transaction custody and destructive-action guards
2. Recovery state machine
3. Isolated runtime/recovery diagnostics
4. Final hardening and implementation close

## Slice 01

Transaction custody is now protected.

When unresolved durable outbox events exist, TINDIO blocks:

- sign out
- organization switching
- Store Hub configuration removal

This prevents unresolved local business transactions from being stranded by destructive context changes.

No outbox data is deleted.

The durable outbox remains `SALE_COMPLETED`.

Phase 16 remains IMPLEMENTING.

## Slice 02

Deterministic connection recovery is now implemented.

Connection states are persisted through local metadata:

```text
CLOUD_ONLINE
STORE_LOCAL
DEVICE_ISOLATED
RECOVERING
SYNC_REVIEW
```

When cloud connectivity returns after offline/local operation, TINDIO does not immediately report online.

It enters:

```text
RECOVERING
```

and runs cloud reconciliation.

`CLOUD_ONLINE` is allowed only when:

- reconciliation succeeds
- no server delta pages remain
- no pending/syncing durable sales remain
- no failed/conflict durable sales require review

If conflict/failed events remain:

```text
SYNC_REVIEW
```

During recovery/review, the business provider intentionally keeps mutation mode offline so online-only workflows stay gated.

Phase 16 remains IMPLEMENTING.
