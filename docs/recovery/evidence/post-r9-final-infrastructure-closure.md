# Post-R9 final infrastructure closure attestation

Prepared: 2026-10-06

## Canonical production authority

- Neon project: `divine-sound-41148108`
- Canonical branch: `br-snowy-heart-b5nf6q3n` (`r6-clean-canonical-20261002`)
- Canonical database: `tindio_r6_recovery`
- Control-plane state: `ready`, `default`, and `primary`
- Canonical Data API: active before and after this closure work

The branch-protection request was attempted once and was rejected by Neon with
HTTP 422 because the current plan has no available protected-branch capacity.
This is a documented plan limitation, not a retryable task. The compensating
controls are the canonical default/primary branch, fail-closed production
tooling, the retired old-source API, and the protected Git default branch with
required certification and deployment checks.

## Retained historical source isolation

- Retained source: `noisy-violet-27747237 / br-dawn-bar-ayd8jk76 / neondb`
- Old-source Data API: deleted on 2026-10-06; a subsequent API lookup returned
  the expected `404 data api not found`.
- Retained database: preserved. A read-only check after the API deletion
  returned `current_database = neondb` and `public_base_table_count = 96`.
- No SQL, schema, data, role, RLS, Auth, Vercel, or Git resource was deleted
  as part of the API retirement.

## Canonical data verification

A read-only canonical query after the old API shutdown returned:

- `current_database = tindio_r6_recovery`
- organizations: `2`
- archived organizations: `0`
- RAZZEY recovery audit rows: `1`
- RAZZEY TRADING CORP.: active and unarchived
- TINDIO Phase 04 Certification: active and unarchived

No business or lifecycle mutation was performed during this closure step.

## Tooling hardening

Ignored local target configuration and the local Neon context were repointed
to the canonical project, branch, and database. The Neon CLI cannot use its
generic environment-pull command for this target because that command requires
a `neondb_owner` role while the canonical database intentionally uses
`tindio_r6_recovery_owner`; the canonical URL was therefore resolved with the
explicit canonical role and never recorded in tracked evidence.

The following production-capable hosted apply/repair scripts now fail closed
unless `DATABASE_URL_UNPOOLED` names the exact canonical direct Neon host and
`tindio_r6_recovery` database:

- `scripts/apply-neon-inventory-count-runtime-boundary-repair.mjs`
- `scripts/apply-neon-pos-workspace-auth-boundary-repair.mjs`
- `scripts/phase-04-v2-hosted-apply.mjs`
- `scripts/phase-05-organization-governance-hosted-apply.mjs`

The generic disposable/local Neon installer remains target-agnostic by design;
it retains its explicit installation confirmation and optional expected-target
guards. Frozen R7/R8 historical migration tooling remains historical evidence,
not an active production apply path.

## Certification and external checks

- Focused canonical-target guard: passed (canonical direct target accepted;
  retained old and pooled targets rejected).
- Full local certification: passed. The clean local replay completed, 79 pgTAP
  files / 1,691 tests passed, database lint had zero errors, and all 20
  Playwright browser checks passed.
- TypeScript, production build, and whitespace validation: passed. ESLint had
  two pre-existing warnings and no errors.
- Hosted Supabase Auth project: its `public` and `private` schemas expose zero
  tables, confirming no TINDIO business database remains there.
- Final canonical read-only query: `tindio_r6_recovery`, two active
  organizations, and zero archived organizations.

## Closure gate

This attestation is merged only after the protected GitHub certification and
Vercel deployment checks pass. The final production read-only verification is
recorded in the execution handoff once the merge commit exists.
