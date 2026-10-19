# TINDIO target architecture

Status: **PLANNED WITH FOUNDATION IMPLEMENTED**

Canonical branch: `TINDIO-PREPRODUCTION`

Architecture decision: [ADR-0001](ADR-0001-neon-only-auth-and-backend-boundary.md)

## Target

```text
Web (Next.js) -----------+
                         +--> Backend HTTP API --> canonical Neon PostgreSQL
Mobile (Expo + SQLite) --+          |                    + Neon Auth
                                    +--> authoritative transactions/RLS

Mobile SQLite = cache + offline custody only
Store Hub = deferred controlled transport, not global authority
```

The repository remains one pnpm workspace and one protected development branch.
Web, Mobile, Backend, Store Hub, contracts, database installers, tests, and
documentation remain in the same repository but gain independent build and
deployment boundaries.

## Approved repository boundaries

| Boundary | Target | Current status |
|---|---|---|
| Web | `apps/web/` eventually; Back Office, Web POS, and public routes remain one Next.js app | **DEFERRED MOVE**; root `src/` remains active to avoid premature path/deployment churn |
| Mobile | `apps/mobile/` Expo/React Native app, package `com.tindio.pos` | **ALREADY IMPLEMENTED** |
| Backend | `apps/backend/` independently built API owning auth, authorization, orchestration, and DB access | **FOUNDATION + FIRST READ ADAPTER IMPLEMENTED**; bootstrap compatibility route is independent, while authorization and data ownership remain in Next.js |
| Contracts | `packages/contracts/` platform-neutral versioned API contracts | **FOUNDATION IMPLEMENTED**; full POS contract separation remains planned |
| Shared | `packages/shared/` only for proven platform-neutral reuse | **DEFERRED**; no empty package created |
| Database | `database/` immutable baseline, ordered migrations, provider adapters | **ALREADY IMPLEMENTED** |
| Store Hub | `apps/store-hub/` | **IMPLEMENTED BUT DEFERRED/UNCERTIFIED** |

## Ownership rules

- Backend owns request authentication, tenant/store/employee/device resolution,
  permission checks, business orchestration, database credentials, structured
  failures, observability, and authoritative writes.
- Neon PostgreSQL owns business truth, atomic checkout, ledgers, immutable
  financial records, RLS, idempotency, and reconciliation checkpoints.
- Web and Mobile consume versioned HTTP contracts; they do not receive privileged
  database credentials.
- Mobile accepts only approved offline work and preserves it durably until the
  Backend establishes the authoritative result.
- Shared packages contain contracts or pure utilities, never server business
  logic, framework UI, provider clients, or secrets.

## Deployment target

Web, Backend, and Android use independent path-aware pipelines. A contracts
change triggers Backend plus supported Web/Mobile compatibility checks. A Web-
only style change does not require an Android binary; a Mobile-only change does
not require Web deployment. Store Hub remains outside certified v1 scope.

## Deferred choices

The Backend foundation uses the standard Web `Request`/`Response` API on the
default Node.js runtime. A higher-level framework and database driver remain
deliberately undecided until a first endpoint extraction measures the existing
service/runtime requirements.
The physical Web move is also deferred until aliases, public assets, Playwright,
Vercel root settings, scripts, and filesystem paths have dedicated proof.
