# TINDIO Neon Recovery R4 Handover

Prepared: 2026-10-01

## Repository checkpoint

- Repository: `razzeysphinx/TINDIOPOS`
- Branch: `recovery/neon-canonical-rebuild`
- Local and remote HEAD: `13810df0b56d00f0b8428e54b6a4af9843771328`
- Commit: `refactor(recovery): normalize roles RLS and security`
- Remote branch: `origin/recovery/neon-canonical-rebuild`

R4 has been implemented, locally certified, committed, and pushed. At the
post-push verification checkpoint, the working tree and index were clean, no
merge conflicts existed, and no historical migration changed.

## Read first

1. `AGENTS.md`
2. `docs/recovery/TINDIO_NEON_RECOVERY_SOURCE_OF_TRUTH.md`
3. The next user-supplied authoritative recovery packet.

The mobile program has a separate source of truth:
`tindio_mobile_neon_source_of_truth.md`. Do not use R4 to authorize mobile
phase work.

## R4 result

R4 normalizes the canonical database authorization surface to TINDIO-owned
roles while keeping provider runtime-role integration in adapters only.

Canonical roles:

- `tindio_anon`
- `tindio_authenticated`
- `tindio_service`

Evidence from the R4 generator:

- 149 total policies
- 141 authenticated-targeted policies retargeted
- 11 provider-auth-helper policies rewritten
- 532 explicit provider ACL grants migrated
- 682 quoted provider-role identifiers in the R3 input
- 0 provider-role identifiers in the R4 canonical baseline
- 0 provider auth helper calls in the R4 canonical baseline
- 0 `auth.role()` calls in the R4 canonical baseline

Canonical baseline SHA256:

```text
b3a0fd6bac3f670b251680698c315e229eff940e05fc1370f5f392b198d50a87
```

## Key files

```text
database/baseline/0001_tindio_baseline.sql
database/baseline/0001_tindio_baseline.manifest.json
database/migrations/0003_provider_neutral_roles_rls.sql
database/provider/local/00_roles.sql
database/provider/neon/00_roles.sql
scripts/recovery/neon-recovery-r4-security-normalize.mjs
scripts/recovery/neon-recovery-r4-security-check.mjs
scripts/recovery/neon-recovery-r4-local-certify.mjs
scripts/recovery/neon-recovery-r3-provider-neutral-sql-check.mjs
scripts/phase-04-neon-baseline-check.mjs
```

`database/provider/local/00_roles.sql` deliberately does not alter the local
Supabase-managed `anon`, `authenticated`, or `service_role` roles: the local
runtime rejects `ALTER ROLE anon` because it is reserved. The adapter verifies
the required roles and establishes membership mappings; the R4 certification
runner proves their inherited-role state and access behavior.

## Verified commands

All of the following passed during R4:

```text
pnpm.cmd recovery:neon:r4:generate
pnpm.cmd test:recovery:neon-r4
pnpm.cmd test:recovery:neon-r3
pnpm.cmd recovery:neon:r4:certify
pnpm.cmd typecheck
pnpm.cmd mobile:typecheck
pnpm.cmd lint
pnpm.cmd build
pnpm.cmd certify:static
```

The R4 local certification reset only the local Supabase database and passed:

- database lint with zero errors
- 79 pgTAP files / 1,688 tests
- zero provider policies, provider auth policy calls, and direct provider ACLs
- 141 canonical authenticated policies
- provider-to-canonical role mappings
- receipt delivery worker executable by `service_role`, not `authenticated`

The static certification passed its full automated package-test catalogue.
Lint had three pre-existing warnings and no errors.

## Boundaries

- No live Neon write, migration, cutover, merge, delete, or deployment was
  performed during R4.
- The 211 historical migrations remain immutable and unchanged.
- Do not undo the canonical roles or reintroduce provider helpers into the
  canonical baseline.
- Keep provider roles and provider auth helpers confined to the adapters.
- Do not weaken RLS, tenant/store isolation, RBAC, idempotency, or the
  service-worker boundary to satisfy a stale source assertion.
- Do not start R5 until the user supplies and authorizes its packet.
- Do not create a PR, merge branches, or delete branches without explicit
  user authorization.

## Next session procedure

The handover file itself is intentionally uncommitted. First inspect it and
the Git state; preserve it or commit it only if the user authorizes that scope.

```powershell
git status --short
git branch --show-current
git rev-parse HEAD
git log -1 --oneline
git diff --check
git diff --cached --check
git ls-files -u
git ls-remote origin refs/heads/recovery/neon-canonical-rebuild
```

Expected committed checkpoint:

```text
recovery/neon-canonical-rebuild
13810df0b56d00f0b8428e54b6a4af9843771328
```

## Next authorized phase

R5 is the next recovery phase:

```text
DATABASE ACCESS + PERFORMANCE REWRITE
```

It is not started. Wait for an explicit R5 master packet and preserve the R4
checkpoint until then.
