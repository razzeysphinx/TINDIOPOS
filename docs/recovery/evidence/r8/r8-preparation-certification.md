# R8 preparation certification

This evidence records only R8 preparation. It does not claim a production
cutover, source freeze, final synchronization, target reset, endpoint switch,
or preview deployment.

## Completed locally

- Git entry preflight matched the pushed R7 checkpoint
  `4a169ae1aef2e09edf59b87f36090a8c6fde0307`; the R4 handover remains the
  sole untracked file.
- R8 deep-dive completed for database routing, Supabase Auth continuity,
  web/server mutation routes, mobile transport/outbox behavior, Vercel project
  metadata, recovery-branch preview metadata, and Neon source/target branch
  identities.
- The maintenance gate is disabled by default and uses server-only
  `TINDIO_CUTOVER_MODE` plus `TINDIO_CUTOVER_BYPASS_SECRET`.
- Local production-build maintenance proof passed:
  - normal API request: HTTP 503, `Retry-After: 60`, `Cache-Control: no-store`;
  - normal browser request: HTTP 307 to `/maintenance`;
  - maintenance page: HTTP 200;
  - bypass request reached the underlying route and returned its normal
    unauthenticated HTTP 401 rather than maintenance 503.
- The temporary local server was stopped and its port released.
- R8 final-sync tooling calls the parameterized R7 migration engine. It never
  selects the obsolete Phase-04 cutover migrator.
- Target reset requires all of `TINDIO_R8_REMOTE_WRITE`,
  `TINDIO_R8_WRITE_FREEZE_CONFIRMED`, and
  `TINDIO_R8_CUTOVER_AUTHORIZED`, proves the exact classified table set, and
  uses no `CASCADE`.

## Automated results

- `pnpm test:recovery:neon-r7:planner`: PASS (3 tests)
- `pnpm test:recovery:neon-r7:trigger-scope`: PASS (2 tests)
- `pnpm test:recovery:neon-r7`: PASS
- `pnpm test:recovery:neon-r8`: PASS
- `pnpm typecheck`: PASS
- `pnpm mobile:typecheck`: PASS
- `pnpm lint`: PASS with 3 pre-existing warnings and no errors
- `pnpm build`: PASS (85 routes)
- `pnpm certify:static`: PASS (145 automated package tests; 2 manual and 1
  local-database categories deferred by the repository catalogue)

## Not started

- Production environment mutation
- Production write freeze
- Preview deployment using an R8 commit
- Target reset/reload
- Final source snapshot
- Endpoint switch
- Production traffic activation
- R8 Source-of-Truth status update
- R8 commit or push
- R9

## External dependency

Vercel exposes the names of production environment variables but encrypts their
values. Independent confirmation of the actual production provider and Data API
host needs explicit approval for a temporary, non-logged environment extraction
or an equivalent platform-provided sanitized inspection. No attempt was made to
bypass that restriction.
