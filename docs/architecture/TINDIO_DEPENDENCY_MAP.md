# TINDIO dependency map

Status: **AUDITED; EXTRACTION MAP ACTIVE**

## Current request paths

```text
Web browser
  -> Next.js proxy / Supabase cookie refresh
  -> Server Component, Server Action, or route handler
  -> BusinessContext (claims + profile + employee + org/store/permission scope)
  -> feature service
  -> Supabase-shaped typed client
  -> fetch rewrite when TINDIO_DATABASE_PROVIDER=neon
  -> Neon Data API
  -> canonical RPC/RLS/functions

Native Mobile
  -> Supabase Auth + SecureStore
  -> Authorization: Bearer <Supabase token>
  -> /api/pos/v2/*
  -> same BusinessContext/service/Data API path
  -> Neon PostgreSQL

Offline Mobile
  -> local authorization grant + SQLite transaction
  -> durable ordered outbox / local receipt
  -> POS v2 sync push on reconnect
  -> canonical idempotent checkout and acknowledgement
```

## Source dependency boundaries

| Source | Depends on | Risk |
|---|---|---|
| `src/app/**` | `src/features`, `src/lib`, Next.js | Web routing and API hosting are colocated |
| `src/app/api/pos/v2/**` | auth context, services, root contract | Best first Backend extraction seam |
| `src/features/**` | typed Supabase-shaped clients and generated DB types | Business logic is reusable but database access is not yet backend-owned |
| `src/contracts/pos.ts` | Platform-neutral DTO/value/result domains delegate to `@tindio/contracts`; Web validation schemas and application-specific aliases remain compatibility exports | No Mobile consumer depends on this root facade; keep it until Web imports can migrate safely |
| `apps/mobile/**` | Mobile-local source plus focused `@tindio/contracts`, `/cart`, and `/ui` package imports | No relative imports cross into the root Web source tree |
| `apps/backend/**` | Backend-local Web API health handler only | Independent build/test boundary exists; no POS, auth, or database dependency has moved yet |
| `apps/mobile/src/features/session` | Supabase session type/client, offline readiness/custody | Auth migration must preserve local financial state |
| `database/provider/neon` | Neon Data API `auth.user_id()` / `auth.jwt()` | Provider adapter seam exists; token semantics still require proof |
| `.github/workflows` | local Supabase, full certification, migration/restore scripts | CI cannot drop Supabase before Auth replacement tests exist |

## Dynamic and operational references

Static imports are not the complete graph. Package scripts dynamically invoke
more than 170 repository checks. Database installers resolve ordered files from
`database/baseline`, `database/migrations`, and provider directories. Recovery
scripts and documents reference stable historical paths. Store Hub loads TLS
files dynamically. These references are why scripts, database history, evidence,
and compatibility routes are retained until focused path migration tests pass.

## Target dependency direction

```text
apps/web -------> packages/contracts <------- apps/mobile
     |                    ^                        |
     +--------------> apps/backend <--------------+
                           |
                    backend-only database/auth
                           |
                    Neon Auth + PostgreSQL
```

Forbidden target edges include Mobile to Web source, contracts to framework or
database clients, browser/mobile to privileged Postgres credentials, and Backend
to Web UI modules.

## Extraction order

1. Keep `src/contracts/pos.ts` as the compatibility facade.
2. Move leaf schemas/types with no Web/database imports into
   `@tindio/contracts`, one coherent domain at a time.
3. Change Web and Mobile consumers to the package and prove old-client response
   compatibility.
4. Extract one read-only POS v2 endpoint behind a Backend compatibility adapter.
5. Extract mutation endpoints only after idempotency, custody, and financial
  replay tests pass against both routes.
