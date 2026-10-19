# TINDIO current architecture audit

Status: **PHASE 0 COMPLETE; PROVIDER CUTOVER NOT STARTED**

Audit date: 2026-10-19

Audited commit: `bb8f3bc15e911f2c1078254a2322111ff209e02c`

Remote reconciliation: local and `origin/TINDIO-PREPRODUCTION` were `0/0` ahead/behind.

## Repository baseline

- 1,494 tracked files at audit start.
- One worktree, clean at the safety gate.
- Root Next.js 16.3.1 App Router application: 54 pages, 51 API route handlers,
  including 41 POS v2 handlers.
- Native Expo SDK 57 application: 20 route TSX files, local SQLite, durable
  outbox, device sequence/checkpoint, offline grants, and receipt snapshots.
- Canonical database: baseline plus 18 ordered forward migrations and separate
  `local`/`neon` provider adapters; 79 database test SQL files.
- One active GitHub Actions workflow on the canonical branch.

## Runtime findings

| Component | Classification | Evidence and rationale |
|---|---|---|
| Root Next.js Web | **KEEP_AND_HARDEN** | Working 90-route production build; keep route groups and defer physical move |
| POS v2 route handlers | **EXTRACT** | Stable compatibility surface, but coupled to Next.js and root services; migrate endpoint-by-endpoint |
| Feature services | **KEEP_AND_HARDEN** | Existing authoritative orchestration must be reused, not rewritten |
| `src/contracts/pos.ts` | **EXTRACT** | Used by Web and 37 Mobile files, but imports Web features/generated DB types; split incrementally |
| `packages/contracts/` | **KEEP_AND_HARDEN** | Foundation package now owns the stable v2 identifier and an independent typecheck |
| Supabase Web session layer | **REPLACE LATER** | Cookie refresh, signup/sign-in/out, claims verification, and protected-route identity are active |
| Supabase Mobile session layer | **REPLACE LATER** | Session persistence/refresh/sign-in/out uses Supabase plus SecureStore |
| Supabase-shaped DB clients | **DEPRECATE LATER** | Seven active SDK import files; some SDK calls are rewritten to Neon Data API and cannot be removed as a blind text cleanup |
| Neon Data API adapter | **KEEP_AND_HARDEN** | Current business DB path; external JWT auth still depends on Supabase JWKS |
| Provider-neutral SQL identity | **KEEP_AND_HARDEN** | Canonical functions isolate subject/email from provider-specific SQL helpers |
| Canonical Neon database | **KEEP** | Project `divine-sound-41148108`, branch `br-snowy-heart-b5nf6q3n`, database `tindio_r6_recovery` |
| Mobile SQLite/outbox | **KEEP** | Financial custody and offline reliability boundary; never reset for Auth migration |
| Store Hub | **KEEP / DEFERRED** | Existing implementation and evidence remain, but v1 release status is deferred |
| Historical Supabase migrations | **KEEP_HISTORICAL** | Recovery/audit evidence, not an active installation path |
| Empty `apps/web`, `apps/backend`, `packages/shared` trees | **DO_NOT_CREATE YET** | No cosmetic directory scaffolding without working implementations |

## Authentication and provider state

Authentication status: **SUPABASE_ACTIVE**.

- Web uses `@supabase/ssr` for cookies and `auth.getClaims()` for verification.
- Mobile uses `@supabase/supabase-js`, SecureStore, session refresh, and bearer
  tokens sent to POS v2.
- `neon.ts` configures Data API external authentication against Supabase JWKS.
- The canonical Neon branch's read-only status reports Data API enabled and no
  managed Neon Auth service. An env-aware configuration plan was not executed:
  the approval system correctly rejected loading a credential-bearing local env
  file into a networked CLI command. No Neon configuration changed.
- A local `NEON_AUTH_BASE_URL` variable exists, but an environment key is not
  provider proof and must not be treated as an enabled service.

Current scan inventory:

- 7 active Web/Mobile files import `@supabase/supabase-js` or `@supabase/ssr`.
- 111 active Web/Mobile files match the broad retirement scan (provider names,
  auth methods, or provider public variable names); this is a migration
  inventory, not 111 removable dependencies.
- 66 feature/lib files contain database `.from()` or `.rpc()` call shapes,
  confirming that Backend extraction must be progressive.

## Configuration and delivery findings

- `pnpm-workspace.yaml` previously discovered only `apps/*`; this slice adds
  `packages/*`.
- Root remains the deployed Web application. Vercel root-directory changes are
  **BLOCKED/DEFERRED** until the physical Web move slice.
- GitHub CI starts isolated local Supabase for deterministic Auth/database tests;
  this is still required while Supabase Auth is active.
- Android production release remains fail-closed under the existing evidence
  gate. No release status changed.

## Pre-change verification

| Gate | Result |
|---|---|
| Web typecheck | **PASS** |
| Mobile typecheck | **PASS** |
| Lint | **PASS WITH 3 PRE-EXISTING WARNINGS** |
| Repository structure | **PASS (7/7)** |
| Web production build | **PASS (90 routes)** |
| Android export | **PASS** |
| Static certification | **FAIL: ENVIRONMENT BLOCKER** — 174/175 automated commands passed; local Supabase/Docker source connectivity was unavailable |
| Canonical migration integrity | **PASS** inside static catalogue |
| Auth/POS/offline source contract tests | **PASS** inside static catalogue |
| Full local database certification | **NOT_RUN** because the local Supabase source was unavailable; prior cleanup documentation also records 11 pre-existing pgTAP contract failures |
| Physical Android rerun | **NOT_RUN**; existing evidence status is preserved |

No production database write, Auth provisioning, account import, deployment, or
provider mutation occurred during this audit.
