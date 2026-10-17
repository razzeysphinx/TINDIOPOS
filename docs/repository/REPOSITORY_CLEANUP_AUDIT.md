# TINDIO Repository Cleanup Audit

Status: **COMPLETE — VERIFIED-SAFE CHANGES ONLY**

Starting branch: `TINDIO-PREPRODUCTION`

Starting SHA: `e01929308627b7f7842f80e183e3ec2add2af631`

Initial tracked files: **1,498**

Initial canonical remote SHA: `e01929308627b7f7842f80e183e3ec2add2af631`

Final tracked files: **1,480**

Directories scanned: **237**

Phase 0 passed with one canonical worktree and a clean tree. The previously
observed untracked Realme files were no longer present when the gate was rerun;
this audit did not delete or relocate them.

## Inventory summary

| Domain | Files | Notes |
|---|---:|---|
| `src/` | 392 | Active Next.js/web/API/domain code |
| `scripts/` | 308 | 236 stable root scripts, 60 recovery, 8 shared helpers, 4 database |
| `docs/` | 225 | Current, mobile, and recovery documentation/evidence |
| `archive/` | 214 | Protected historical database migrations + manifest |
| `apps/` | 199 | Mobile POS and deferred Store Hub |
| `supabase/` | 81 | Auth/local configuration and canonical database tests; no business migrations |
| `database/` | 26 | Canonical baseline, forward migrations, provider adapters |
| `.agents/` | 16 | Locked development-agent resources |
| `public/` | 6 | Five unused starter SVGs plus active service worker |
| `tests/` | 4 | Phase 14 browser certification suite |
| `.github/` | 3 | One canonical and two historical branch workflows |

The machine-readable per-file classification is in
`repository-inventory.json`. Every starting tracked file has exactly one action
category.

## Duplicate analysis

Six byte-identical groups were found. Recovery r7/r8 evidence, repeated physical
UI hierarchy dumps, and final/migration evidence are intentionally distinct and
are preserved. The two identical Expo starter images are unreferenced template
assets and are safe deletion candidates. Near-name analysis proved the singular
and plural inventory count scripts cover different semantics and must remain.

## Reference findings

- All 63 direct file targets extracted from root package scripts existed.
- The package catalogue contains 228 scripts; 175 are `test:*` commands and are
  automatically discovered unless explicitly classified by the certifier.
- Five public starter SVG files have zero references.
- `public/service-worker.js` is registered by the active offline boundary and is
  explicitly excluded from proxy interception; it remains active.
- POS unversioned compatibility routes forward to v2 and remain supported.
- `neon.ts` references `hello.ts`; both remain infrastructure-stable.
- Mobile support/diagnostic routes are permission-gated. Route-group movement
  would create broad test/navigation churn without a behavior benefit.
- Root scripts have extensive package/workflow/document/script references; mass
  movement is rejected as high risk.

## Action log

| Before path | Action | After path | Reason | Reference count | Risk | Validation |
|---|---|---|---|---:|---|---|
| `README.md` | REWRITE | same | Current repository entry point | n/a | Low | links + build |
| `apps/mobile/README.md` | REWRITE | same | Remove Expo starter instructions | n/a | Low | structure check |
| `plan/*.txt` | MOVE_SAFE | `docs/archive/plans/*.md` | Implemented historical specifications; no path references | 0 | Low | link/path scan |
| five `public/*.svg` starter files | DELETE_CANDIDATE | removed | Re-proven zero references | 0 each | Low | build + structure check |
| `public/service-worker.js` | KEEP_ACTIVE | same | Registered offline runtime asset | 2 direct runtime refs | High if removed | build + offline tests |
| 23 Expo starter assets under `apps/mobile/assets/images` and `expo.icon` | DELETE_CANDIDATE | removed | No application/config/document references | 0 | Low | Android export |
| historical workflows | MERGE_CANDIDATE | baseline workflow | Dead branch triggers; protections already present or merged | phase contracts updated atomically | Medium | contract + static certification |
| root scripts | KEEP_ACTIVE / KEEP_HISTORICAL | same | Broad reference graph and operational roles | varied | High if moved | package reference check |
| mobile routes | KEEP_ACTIVE / KEEP_DEFERRED | same | URLs and permission inheritance are stable | varied | Medium if moved | route checks |
| recovery evidence | KEEP_HISTORICAL | same | Audit integrity | varied | Critical if changed | recovery contracts |
| `apps/mobile/LICENSE` | UNKNOWN_REQUIRES_REVIEW | same | Legal/ownership decision | n/a | Owner decision | preserved unchanged |

## Non-negotiable preservation

No database migration, production data, Neon production state, Supabase business
schema, package ID, signing input, release outcome, evidence outcome, or Git
history is changed by this cleanup.

## Validation result

| Gate | Result | Notes |
|---|---|---|
| Frozen dependency install | PASS | Lockfile remained unchanged |
| Web typecheck | PASS | `pnpm typecheck` |
| Mobile typecheck | PASS | `pnpm mobile:typecheck` |
| Lint | PASS WITH WARNINGS | 0 errors; 3 pre-existing warnings |
| Web production build | PASS | 90 routes built |
| Android export | PASS | Expo Android bundle exported successfully |
| Static certification | PASS | All 173 automated package commands passed |
| Structure regression check | PASS | 7/7 checks passed |
| Git whitespace | PASS | `git diff --check` |
| Full local certification | FAIL | Static phase passed; local pgTAP found 11 pre-existing contract failures in two database test files |

The full local certification failure is outside this repository-hygiene change:

- `improvement_12_device_register_management.test.sql` has four assertions that
  still use the retired two-argument device-revocation contract. The canonical
  function now requires an explicit transaction-custody decision.
- `phase_26_production_observability.test.sql` has seven assertions for an older
  telemetry RPC signature and therefore cannot persist the expected aggregate
  fields.

No schema, migration, or business behavior was changed to conceal these failures.
The local canonical installer completed successfully before pgTAP ran. Production
and hosted Neon databases were never targeted.

## Final change summary

- Deleted 28 proven-unused template assets and two obsolete historical workflows.
- Moved five implemented plans from `plan/` to indexed historical documentation.
- Consolidated required workflow protections into the one canonical baseline
  workflow.
- Rewrote repository and mobile entry-point documentation and added documentation,
  archive, script, API compatibility, structure, deprecation, and audit guides.
- Added a deterministic repository inventory and seven-check structural regression
  suite to static certification.
- Preserved all canonical migrations, archived migrations, recovery/mobile evidence,
  compatibility routes, Store Hub, and root Neon infrastructure paths.
