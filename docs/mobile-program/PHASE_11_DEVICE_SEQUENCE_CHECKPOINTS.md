# Phase 11 Device Sequence + Checkpoints

PHASE 11 IMPLEMENTATION: COMPLETE

PHASE 11 STATUS: VALIDATING

TESTS: DEFERRED BY USER

Each native durable event receives its `device_sequence` atomically with SQLite enqueue. A server checkpoint is the highest contiguous terminal sequence confirmed by the server.

The server reserves a sequence before checkout mutation. The same sequence and idempotency key is a permitted replay; a different key is a conflict. Future sequences with a gap are rejected before mutation, and old unexpected sequences are out-of-order conflicts.

Retryable checkout failures leave the receipt `RECEIVED` and do not advance the checkpoint. Successful checkouts finalize `APPLIED`; deterministic conflicts finalize `CONFLICT`; either terminal state advances the contiguous checkpoint. No secret is stored in SQLite.

Phase 12 remains delta sync + cloud reconciliation and is not implemented here.

PHASE_11_IMPLEMENTATION_COMPLETE_TESTS_DEFERRED
