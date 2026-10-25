# Phase I2 — provider retirement gate

Provider retirement is gated independently from implementation readiness and
production cutover. All twelve requirements must be explicit boolean `true`.
Missing, false, or descriptive values fail closed.

The gate includes account accounting, all active clients, the supported-client
window, Auth flows, tenant isolation, financial replay, offline custody,
backup/rollback, production observation, and separate owner approval.

**Decision:** `DO_NOT_RETIRE`. Supabase tokens remain accepted by supported
clients and Supabase remains the runtime default.
