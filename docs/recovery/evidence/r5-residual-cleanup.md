# TINDIO R5 Residual Read-Path Cleanup

Branch: `recovery/neon-canonical-rebuild`

Checkpoint: `R5 residual proven read fan-out`

## Consolidated residual paths

The post-C access census identified receipt detail and time-clock workspaces as
the remaining read-heavy feature loaders with a clear bounded-data shape.
Checkpoint D adds:

- `public.get_receipt_detail_bundle_v1`
- `public.get_time_clock_workspace_bundle_v1`

| Surface | Before direct `.from()` | After direct `.from()` |
| --- | ---: | ---: |
| Receipt detail loader | 13 | 0 |
| Time-clock loader | 6 | 0 |

Receipt store authorization and refund/reprint capability checks remain in the
application loader; optional reprint/refund extension payloads are explicitly
requested. The existing current-entry and attendance RPCs remain semantic
contracts. Authentication DAL and shift orchestration were reviewed but left
unchanged: no safe, evidence-proven replacement was required.

Both new functions are `STABLE`, `SECURITY INVOKER`, safe-search-path, revoke
`PUBLIC`, and grant only `tindio_authenticated`.

## Measured result

The regenerated R5 census records 130 `.from()` calls, 188 `.rpc()` calls, and
318 total static DB call sites across 379 scanned files. Compared to the
R5-S1 baseline, direct table-read call sites fell from 272 to 130 and total
static DB call sites from 449 to 318.

## Certification

- Residual static contract and canonical recovery-chain replay through `0010`.
- Zero-UUID function smoke tests, invoker/grant checks, and local DB lint.
- Receipt/refund, attendance, time-clock, shift accountability, and shift audit
  regressions.
- Root and mobile typechecks; ESLint with zero errors and three pre-existing
  warnings; production build.
- Full static repository certification (140 automated package test commands).
- R5 census reproducibility contract.

## Safety

- Live Neon schema writes: `0`
- Live Neon business-data writes: `0`
- Historical Supabase migrations modified: `0`
- Pushed canonical migrations 0002 through 0007 rewritten: `0`
- Tenant/store isolation, RLS, RBAC, checkout, payments, inventory, and mobile
  API semantics: unchanged.
