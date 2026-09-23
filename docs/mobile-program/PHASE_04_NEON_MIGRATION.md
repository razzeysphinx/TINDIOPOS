# TINDIO Mobile Program — Phase 04

## Neon Readiness + Database Migration

SOURCE_OF_TRUTH:
`docs/TINDIO_MOBILE_NEON_SOURCE_OF_TRUTH.md`

STATUS:
`VALIDATING`

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
PHASE_STATUS: VALIDATING

JWKS_EXTERNAL_AUTH: PENDING
NEON_DATA_API: PENDING
NEON_SCHEMA_REHEARSAL: PENDING
SOURCE_TARGET_RECONCILIATION: PENDING
NEON_IDENTITY: PENDING
TENANT_ISOLATION: PENDING
STORE_ISOLATION: PENDING
CHECKOUT_RPC_PRESENT: PENDING
LOCAL_FULL_CERTIFICATION: PENDING
PREPRODUCTION_CUTOVER: PENDING

SUPABASE_AUTH_RETAINED: YES
SUPABASE_REALTIME_RETAINED: YES
NEON_AUTH_ADOPTED: NO
```
