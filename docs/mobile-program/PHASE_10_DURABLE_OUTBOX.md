# Phase 10 Durable Outbox

IMPLEMENTATION: COMPLETE

STATUS: VALIDATING

TESTS: DEFERRED BY USER

## Delivered scope

- SQLite schema v4 stores durable `SALE_COMPLETED` events only.
- Offline acceptance is restricted to a Phase 08-authorized, matching organization/device/store/register/shift, cached eligible cash payment method, and supported fixed-price cart lines.
- SQLite commits the event before the POS clears a cart or reports `SAVED LOCALLY`.
- Events keep their idempotency key, payload, and immutable secret-free snapshot for all retries and are never automatically deleted.
- Delivery is a one-at-a-time FIFO attempt to `/api/pos/v2/offline-checkout`; a stale `SYNCING` state is recovered after 60 seconds.
- The SecureStore device credential is loaded only when delivery begins and is not persisted in the outbox.
- Sync Status exposes safe queue diagnostics and an online-only manual sync action.

## Boundaries retained

- The Backend V1 endpoint and authoritative checkout/inventory logic remain unchanged.
- Phase 11 device sequences/checkpoints and Phase 12 delta sync are not implemented.
- Electronic offline payments are not implemented.

PHASE_10_IMPLEMENTATION_COMPLETE_TESTS_DEFERRED
