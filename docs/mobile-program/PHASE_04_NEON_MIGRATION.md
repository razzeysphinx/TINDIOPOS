# TINDIO Mobile Program — Phase 04

## Neon Readiness + Database Migration

SOURCE_OF_TRUTH:
`docs/TINDIO_MOBILE_NEON_SOURCE_OF_TRUTH.md`

STATUS:
`COMPLETE`

## Provider split

```text
Authentication:
Supabase Auth

Database:
Neon PostgreSQL

Database API:
Neon Data API

Realtime:
Supabase Realtime temporarily retained
```

## Identity

```text
Supabase JWT subject
→ Neon Data API external JWKS verification
→ auth.user_id()
→ private.current_identity_subject()
→ private.identity_links(provider='supabase')
→ stable TINDIO profile
```

## Database routing

Server-side Supabase REST requests are redirected:

```text
Supabase /rest/v1/*
→ Neon Data API
```

Supabase Auth requests remain on Supabase.

Browser business-table access is prohibited.

### Final Phase 04 source topology

The original TINDIO business database source was the local Supabase CLI/Docker PostgreSQL instance.

There was no hosted Supabase business database to cut over from.

The final Phase 04 topology is:

- Neon PostgreSQL — authoritative TINDIO business database
- Neon Data API — server database API surface
- Hosted Supabase — Auth + Realtime
- Local Supabase Docker — development/certification environment

The earlier remote-Supabase cutover prerequisite was retired because it described an environment that never existed.

Hosted Supabase JWKS verification is an explicit external integration certification and is intentionally excluded from unattended local/CI package-test execution.

### Canonical certification after provider separation

Phase 04 separates hosted authentication from local destructive database certification.

- `NEXT_PUBLIC_SUPABASE_URL` may point to hosted Supabase Auth.
- Local destructive certification never derives its database target from that URL.
- Database reset/test commands use explicit `--local`.
- The certification engine validates the actual Supabase CLI `API_URL` and `DB_URL` as local before destructive operations.
- Phase 14 Playwright remains automated, but runs as a local-database integration test only after clean local migration replay.
- Phase 14 explicitly forces local Supabase Auth + local Supabase database mode.
- Hosted Supabase JWKS verification remains an explicit external integration certification.

## Rollback

Supabase database remains intact through Phase 05.

Do not roll back after new Neon writes without explicit reconciliation.

## Completion

```text
PHASE_STATUS: COMPLETE

JWKS_EXTERNAL_AUTH: COMPLETE
NEON_DATA_API: COMPLETE
NEON_SCHEMA_REHEARSAL: COMPLETE
SOURCE_TARGET_RECONCILIATION: COMPLETE
NEON_IDENTITY: COMPLETE
TENANT_ISOLATION: COMPLETE
STORE_ISOLATION: COMPLETE
CHECKOUT_RPC_PRESENT: COMPLETE
LOCAL_FULL_CERTIFICATION: COMPLETE
PREPRODUCTION_CUTOVER: COMPLETE

SUPABASE_AUTH_RETAINED: YES
SUPABASE_REALTIME_RETAINED: YES
NEON_AUTH_ADOPTED: YES
```

## Phase 04 Closure

Status: COMPLETE

Authoritative POS API: V2

Supabase:
- authoritative authentication provider
- Realtime/Storage remain available where used

Neon:
- authoritative TINDIO business-data provider

POS V2:
- Core
- Reference
- Live
- Catalog
- Modifiers
- operational command API

Legacy V1:
- /api/pos/v1 retired
- monolithic V1 bootstrap retired
- V1 deployed certification retired

Temporary compatibility aliases retained:
- /api/pos/checkout
- /api/pos/offline-checkout
- /api/pos/customers
- /api/pos/device
- /api/pos/customer-display

Certification:
- V2 deployed reliability: 1000/1000 PASS
- V2 browser certification: PASS
- provider/auth regression: PASS
- V1 extraction/retirement: PASS
- post-merge V2 smoke: PASS
- post-merge tenant/store/register isolation: PASS
