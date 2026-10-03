# Phase 12 Delta Sync + Cloud Reconciliation

PHASE 12 IMPLEMENTATION: COMPLETE

PHASE 12 STATUS: VALIDATING

TESTS: DEFERRED BY USER

Push sends at most 20 ordered `SALE_COMPLETED` events to `/api/pos/v2/sync/push`; local events become synced only from ordered server ACKs. Pull reads only revisions after the persisted local cursor from `/api/pos/v2/sync/pull`, applies changed catalog products, customer tombstones, bounded reference snapshots, modifier invalidation, and safe device metadata, then advances the cursor last.

Synchronized domains are catalog/prices, reference/configuration (including taxes and discounts), customers, device configuration, and modifier invalidation. Authoritative inventory merging, store-hub state, electronic payments, and native cashier feature parity remain out of scope.

PHASE_12_IMPLEMENTATION_COMPLETE_TESTS_DEFERRED
