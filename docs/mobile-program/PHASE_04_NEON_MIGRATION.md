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
