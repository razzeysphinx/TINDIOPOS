# Phase E planned slice E6: adversarial authorization and rollback closure

Status: **PHASE E COMPLETE — 13/13 FLOWS PASS**

Completed: 2026-10-24

This is the sixth and final slice in the original Phase E plan. The earlier
E4–E6 labels in individual implementation commits were internal gates inside
the original Web-integration slice; they did not add phases or planned slices.

## Adversarial Data API and RLS proof

The disposable branch proof created one reserved `.invalid` Neon identity, two
synthetic profiles, one identity link, and two synthetic organizations. The
organization seed triggers were disabled and re-enabled inside the same
transaction, so no default merchant configuration was created.

A real Neon JWT mapped only to tenant A could read tenant A. Tenant B remained
invisible both in an unrestricted list and an explicit tenant-B filter, even
when the request forged tenant B in `x-tindio-organization-id`. Malformed and
signature-tampered JWTs were rejected. The exact real JWT was verified against
Neon's live JWKS at a cryptographic time one second beyond its signed `exp` and
was rejected with `ERR_JWT_EXPIRED`.

The proof then signed out the session, removed the application identity link,
and replayed the still-signed JWT. `current_profile_id()` returned null and RLS
returned zero organizations. This demonstrates the application revocation
boundary independently of bearer-token lifetime.

Cleanup verified zero temporary profiles, links, or organizations, deleted the
synthetic Auth identity, and restored the original branch Auth configuration.
Two exact reserved leftovers from failed diagnostic runs were also removed.

## Supabase rollback proof

With provider selection omitted, the Web selector resolved to `supabase` and
the Mobile Neon proof guard stayed disabled. Two independent clients then
established Web-style and Mobile-style password sessions for the existing
preproduction test identity. Both observed the same Supabase subject, and the
Mobile bearer resolved a stable profile through the canonical Neon Data API.

Both proof sessions were signed out with local scope only. Device identity,
offline authorization, the dormant Neon proof cookie, SQLite transaction
custody, receipt snapshots, and outbox events remained unchanged. No provider,
origin, environment file, deployment, canonical identity mapping, or merchant
row was changed.

Evidence is recorded in:

- `TINDIO_PHASE_E_PLANNED_E6_ADVERSARIAL_RLS_PROOF.json`
- `TINDIO_PHASE_E_PLANNED_E6_SUPABASE_ROLLBACK_PROOF.json`

All 13 required Phase E flows now pass. Phase F may begin only as an identity
inventory and deterministic dry-run mapping phase; real-user import, password
migration, production cutover, and Supabase decommission remain explicit owner
stop points.
