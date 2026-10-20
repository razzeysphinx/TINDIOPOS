# TINDIO migration sequence

Status: **IN PROGRESS**

| Slice | Scope | Status | Exit gate |
|---|---|---|---|
| A | Audit, target architecture, ADR, dependency map, baseline | **IMPLEMENTED** | Clean/synchronized Git; evidence recorded; no production mutation |
| B1 | Add `packages/*`, contracts foundation, independent commands | **IMPLEMENTED** | Typecheck/build/compatibility checks pass |
| B2 | Extract platform-neutral POS contract leaves and remove Mobile relative Web imports | **IMPLEMENTED** | Backend/Web/Mobile contract tests; unchanged wire format |
| B3 | Decide and perform root Web to `apps/web/` move | **DEFERRED** | Dedicated Vercel, alias, public asset, Playwright, env, and script proof |
| C | Create real `apps/backend/` and extract first read-only endpoint | **IMPLEMENTED** | Independent health/build/test plus dual-route compatibility |
| D | Progressive Backend extraction, mutations last | **IN PROGRESS — FIRST READ OWNED** | Financial/idempotency/offline replay equivalence |
| E | Isolated synthetic Neon Auth proof on a non-production branch | **OWNER/PROVIDER PREREQUISITES** | Required 13-flow proof including Mobile, RLS, revocation |
| F | Identity inventory, deterministic mapping, dry-run tooling | **PLANNED** | All users accounted for; no privilege drift; no real import |
| G | Web and Mobile dual-transition Auth migration | **PLANNED** | In-place Mobile upgrade preserves SQLite/outbox/device custody |
| H | Controlled production cutover | **OWNER APPROVAL REQUIRED** | Monitoring, rollback, supported clients, tenant/financial proof |
| I | Remove active Supabase runtime dependencies | **PLANNED** | Zero supported-client dependency; separate decommission approval |
| J | Performance measurement, cleanup, independent CI/CD | **PLANNED** | Evidence-based optimization and final certification |

## Completed Slice C

- Create the independent `apps/backend/` foundation with its own health,
  typecheck, build, and test commands. **IMPLEMENTED.**
- Keep the foundation stateless and provider-neutral, with no client-origin,
  authentication, database, or POS route change. **IMPLEMENTED.**
- Extract one read-only POS v2 endpoint behind a dual-route compatibility
  adapter: the already package-typed bootstrap core response. **IMPLEMENTED.**
- Keep the existing Next.js route active and prove identical authentication,
  authorization, status, headers, and JSON response behavior. **IMPLEMENTED.**
- Do not move checkout, sync-push, custody, or other mutation endpoints in the
  foundation slice. **IMPLEMENTED.**

## Completed Slice D1: bootstrap read ownership

- Bootstrap authentication, organization scoping, POS permission checks, and
  Neon Data API core loading are Backend-owned. **IMPLEMENTED.**
- `TINDIO_BOOTSTRAP_READ_MODE=proxy` retains the allowlisted Web compatibility
  adapter as an explicit rollback. **IMPLEMENTED.**
- The owned path preserves the 200/401/403/503 response envelope, retry rule,
  cache control, and request ID without exposing identity or token data.
  **IMPLEMENTED.**
- All mutations remain in Next.js and both clients retain their current origin.
  **IMPLEMENTED.**

## Next smallest safe slice: D2 another read-only domain

- Select one non-financial POS reference read that already has a stable shared
  contract and move its server ownership behind the same Backend boundary.
- Keep checkout, sync-push, shift custody, and every other mutation in Next.js.
- Preserve the Web route as rollback and prove supported-client compatibility
  before any deployed origin change.

Do not change a deployed API origin or route clients to the new Backend without
separate compatibility evidence and approval.

## Mandatory stop points

Stop for explicit approval before production Neon Auth enablement, real account
export/import, password migration, credential rotation, deployed API-origin
change, live client cutover, Supabase shutdown/deletion, or merchant-data writes
outside established controlled operations.
