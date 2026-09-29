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

## Slice 02

Native mobile Store Hub configuration is now available.

Security behavior:

- Store Hub token is stored only in SecureStore.
- Token is not persisted in SQLite.
- Public internet hostnames are rejected.
- Allowed Hub endpoints are private IPv4, localhost, or `.local`.
- Hub health identity must match the enrolled organization and store.
- Mobile cloud bearer/Supabase tokens are never forwarded to the Hub.

Local SQLite schema version 7 adds:

- `store_hub_state`
- `store_hub_events`
- `store_hub_publish_state`

Phase 15 remains IMPLEMENTING.


## Slice 03

Store Hub device coordination is implemented.

Each terminal can:

- publish minimal metadata for its durable `SALE_COMPLETED` events
- publish later cloud-sync status updates for the same event identity
- pull Store Hub changes by Hub revision
- persist peer event awareness locally
- include known peer sale activity in inventory estimates

Critical rule:

```text
STORE HUB ACK != CLOUD ACK
```

A Hub acknowledgement never marks the cloud durable outbox event as synced.

Inventory remains an estimate and the Neon/server ledger remains authoritative.
