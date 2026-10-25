# Phase I1 — Supabase dependency inventory

The repository still has active Supabase dependencies in Web, Mobile, Backend,
workspace packages, environment contracts, and CI/certification tooling.
Supabase is therefore an active provider, not dead code.

The inventory separates active runtime/configuration, transition tooling, and
historical evidence. Database migrations and audit records are retained even
after a future provider retirement. The controlling H5 decision is `NO_GO`, so
this slice authorizes no package removal, environment deletion, token rejection,
project shutdown, or production change.

**Decision:** inventory complete; removal blocked.
