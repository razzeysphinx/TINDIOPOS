# MOB-14 Slice 02 — Protected production submission

## Outcome

The repository production-draft command can no longer invoke EAS directly.
It first evaluates the complete Phase 24 evidence and verifies that the build
commit is in current history, the mobile source still matches that commit, the
lockfile hash matches, the worktree is clean and the EAS build identity is
valid. If allowed, it submits only the recorded build ID through the existing production profile,
which remains configured with `releaseStatus: draft`.

No build, upload or Google Play submission occurred in this slice.

## Starting point and gap matrix

- Branch: `TINDIO-PREPRODUCTION`
- Starting commit: `83046e07571092965435394486067c96b3285db1`

| Decision | Area | Result |
|---|---|---|
| KEEP | EAS production profile and draft release status | No uncontrolled rollout behavior is introduced. |
| KEEP + HARDEN | Production submission package command | It now enters the protected Node wrapper. |
| EXTEND | Build binding | Require build-commit ancestry, unchanged mobile source, lockfile hash, clean tree and exact EAS build ID. |
| REFACTOR | None | The Slice 01 evidence evaluator is reused directly. |
| REPLACE | Direct production `eas submit` command | Replace it with the fail-closed wrapper. |
| REMOVE | Interactive build selection | Production submission always uses `--id`. |
| NEW | Submission planner and behavioral tests | Tests prove that a blocked plan never spawns EAS. |

## Impact

There are no application, database, SQLite, API, authentication, tenant/store
authorization or transaction-custody changes. No credentials are read or
stored by the wrapper. EAS continues using its assigned Google service account.

## Acceptance status

- Phase 24 production-promotion protection: implemented in repository command.
- Current production submission: expected `BLOCKED` because release evidence is
  incomplete.
- A46, A47 and A48: unchanged; external evidence remains `NOT_RUN`.
- Production AAB and Google Play submission: `NOT_RUN`.

## Validation

- `pnpm test:mobile-mob-14-production-submit`: PASS, 5/5.
- `pnpm test:mobile-mob-14-production-gate`: PASS, 6/6.
- `pnpm test:phase-24-google-play`: PASS, 7/7.
- `pnpm test:phase-23-android-hardening`: PASS, 6/6.
- `pnpm typecheck`: PASS.
- `pnpm mobile:typecheck`: PASS.
- `pnpm lint`: PASS with 0 errors and 3 pre-existing warnings.
- `pnpm mobile:export:android`: PASS.
- Protected production command: expected `PHASE_24_PRODUCTION_SUBMISSION_BLOCKED`;
  no EAS process or Google Play request started.
- `pnpm certify:static`: 161/163 automated package commands passed. The
  unchanged environment-dependent `test:phase-14-final-recovery` and
  `test:phase-04-docker-source-connectivity` checks failed because the local
  Supabase source is unavailable.
- `git diff --check`: PASS.

## Next MOB-14 work

Harden native crash/ANR and production telemetry behavior, followed by
actionable sanitized alert routing and operational runbook validation.
