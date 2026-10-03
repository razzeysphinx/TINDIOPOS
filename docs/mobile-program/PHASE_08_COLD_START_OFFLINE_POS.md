# Phase 08 — Cold-Start Offline POS

PHASE 08 IMPLEMENTATION: `COMPLETE`

PHASE 08 STATUS: `VALIDATING`

Offline authorization is a SecureStore-backed, 12-hour lease with a five-minute clock-rollback tolerance. Online preparation requires an active organization, validated enrolled terminal, matching active shift, reference/configuration snapshot, and complete store-catalog snapshot.

Offline resume validates the lease, business context, employee/profile, device, store, register, shift, reference configuration, and complete catalog. Explicit server HTTP 401/403 responses fail closed. Expired leases require online reauthentication, and explicit sign-out revokes the lease.

Offline mutations, offline shift changes, checkout, local-first interactions, outbox operations, checkpoints, and delta sync are not implemented. Phase 09 owns local-first interactions; Phase 10 owns the durable operation/outbox engine.
