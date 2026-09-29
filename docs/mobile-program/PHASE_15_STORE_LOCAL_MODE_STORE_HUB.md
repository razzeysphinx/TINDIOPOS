# Phase 15 â€” Store Local Mode / Store Hub

## Status

IMPLEMENTING

## Slice plan

1. Durable Store Hub service foundation
2. Secure mobile Hub configuration + local cache
3. Device publish/pull coordination + peer inventory awareness
4. Store-local connection mode + diagnostics + implementation close

## Architecture

```text
POS A â”€â”
POS B â”€â”¼â”€â”€ TINDIO STORE HUB
POS C â”€â”˜
```

The Store Hub is not the authoritative business database.

The cloud/Neon inventory ledger remains authoritative.

## Slice 01

Implemented a LAN Store Hub service with:

- store-scoped Bearer authentication
- organization/store scope enforcement
- durable append-only JSONL journal
- fsync on accepted journal writes
- idempotent event replay by `eventId`
- immutable event identity conflict detection
- Hub revision/cursor feed
- minimal `SALE_COMPLETED` activity metadata only

The Store Hub intentionally does not accept:

- customer information
- payment information
- card information
- receipts
- Supabase/auth session tokens

Phase 15 remains IMPLEMENTING.
