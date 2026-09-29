# Phase 15 — Store Local Mode / Store Hub

## Implementation status

**IMPLEMENTATION COMPLETE**

## Certification status

**VALIDATING**

Full runtime certification is deferred by the user.

## Goal

Allow terminals in one physical store to coordinate over the store LAN when cloud internet is unavailable.

## Connection modes introduced

```text
CLOUD_ONLINE
STORE_LOCAL
DEVICE_ISOLATED
```

When cloud access fails but the Store Hub is reachable, native mobile enters:

```text
STORE_LOCAL
```

When both cloud and Store Hub are unavailable, the device is identified as:

```text
DEVICE_ISOLATED
```

Full isolated-device behavior is Phase 16.

## Store Hub architecture

```text
POS A ─┐
POS B ─┼── TINDIO STORE HUB
POS C ─┘
```

The Hub is a dedicated LAN coordination process.

It is not the authoritative business database.

## Security

The Hub requires:

- explicit organization scope
- explicit store scope
- 32+ character store-scoped token
- matching organization/store event scope

Native mobile:

- stores the Hub token only in SecureStore
- rejects public internet Hub URLs
- accepts private IPv4, localhost, or `.local`
- never stores the Hub token in SQLite
- never forwards cloud/Supabase access tokens to the Hub

## Data minimization

The Hub journal stores only minimal sale awareness:

- event ID
- organization ID
- store ID
- device ID
- device sequence
- local reference
- product/variant IDs
- quantities
- local created time
- later cloud-synced timestamp

The Hub does not store:

- customer data
- payment data
- card data
- receipts
- authentication session tokens

## Durability

The Store Hub uses an append-only JSONL journal.

Accepted journal writes are fsynced.

Event replay is idempotent by `eventId`.

Immutable identity mismatches are rejected.

Updates such as later `cloudSyncedAt` receive a new Hub revision.

## Mobile coordination

Each terminal can:

- publish its local durable sale metadata
- update the Hub after cloud sync later succeeds
- pull peer events by Hub revision cursor
- cache peer event state in SQLite
- use known peer activity for local stock estimates

## Acknowledgement rule

```text
STORE HUB ACK != CLOUD ACK
```

A Store Hub acknowledgement never marks the cloud outbox event synced.

Only authoritative server/cloud acknowledgement may do that.

## Inventory rule

Store-local inventory awareness remains:

```text
ESTIMATE ONLY
```

The server/Neon inventory ledger remains authoritative.

The Hub does not overwrite central stock.

## SQLite

Phase 15 adds local schema version 7:

- `store_hub_state`
- `store_hub_events`
- `store_hub_publish_state`

Store Hub tokens are not stored in SQLite.

## Current supported Hub coordination

Implemented:

- local acknowledgements
- minimal store event coordination
- peer sale awareness
- store-local inventory awareness

Not yet implemented here:

- KDS coordination
- local printing
- hardware discovery
- automatic Hub deployment
- Phase 16 isolated-device recovery hardening

## Certification still required later

- real multi-device LAN runtime
- router/internet outage
- Store Hub restart
- journal restart recovery
- duplicate publish
- Hub unavailable fallback
- cloud return after Store Local operation
- peer event update after cloud ACK
- cross-store denial
- cross-tenant denial
- Android runtime behavior

## Phase status

```text
PHASE 15
IMPLEMENTATION COMPLETE
STATUS: VALIDATING
CERTIFICATION: DEFERRED
```

Next canonical phase after ChatGPT review:

```text
PHASE 16 — ISOLATED DEVICE MODE
```
