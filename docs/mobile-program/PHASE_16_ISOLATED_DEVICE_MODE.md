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
