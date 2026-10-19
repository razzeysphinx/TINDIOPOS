# ADR-0001: Neon-only identity and dedicated backend target

- Status: **ACCEPTED TARGET; MIGRATION IN PROGRESS**
- Date: 2026-10-19
- Decision owner: TINDIO
- Starting commit: `bb8f3bc15e911f2c1078254a2322111ff209e02c`

## Decision

TINDIO will converge on one monorepo with an independently deployable Web app,
native Mobile app, and Backend API. Neon Auth will become the sole production
identity/session provider, and the existing canonical Neon PostgreSQL database
will remain the sole business authority. Mobile SQLite remains a device-local
offline cache and transaction-custody store, not a second business authority.

Supabase Auth remains active during a controlled compatibility period and is
retired only after synthetic Neon Auth proof, identity mapping, Web/Mobile
upgrade certification, tenant/RLS proof, monitoring, rollback evidence, and
explicit owner approval.

## Context

The current product is a hybrid:

- the root Next.js application owns Web UI, server actions, POS v2 route
  handlers, authorization orchestration, and most business services;
- Supabase Auth issues Web cookie and Mobile bearer sessions;
- the Supabase JavaScript SDK is also used as the PostgREST-shaped client;
- POS database requests are rewritten to the canonical Neon Data API;
- provider adapters already isolate SQL identity through
  `private.current_identity_subject()` and `private.current_identity_email()`;
- Mobile owns durable SQLite/outbox custody that must survive provider changes.

The linked canonical Neon branch reports Data API enabled but does not report a
managed Auth service. The checked-in `neon.ts` declares `auth: true`; this is
configuration drift, not proof that Neon Auth is live. No apply was performed.

## Consequences

- Existing API paths and financial identities stay compatible throughout
  extraction.
- Backend extraction reuses current services; it must not create a second
  checkout, inventory, or reconciliation engine.
- Historical Supabase migrations and recovery evidence remain immutable.
- Production Auth provisioning, real-user import, credential rotation, client
  cutover, deployment, and provider deletion require separate approval.
- The older provider statement in `docs/architecture.md` remains historical
  implementation context and is superseded only for the future provider target.

## Preserved decisions

This ADR does not alter tenant isolation, permissions, immutable financial
records, checkout idempotency, stock ledgers, device sequencing, offline grants,
outbox custody, reconciliation, release gates, or physical-evidence status.
