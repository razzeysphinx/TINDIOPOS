# TINDIO R5 Final Performance + Certification

Branch: `recovery/neon-canonical-rebuild`

## Static access measurements

| Checkpoint | `.from()` | `.rpc()` | Total static DB call sites |
| --- | ---: | ---: | ---: |
| R5-S1 original baseline | 272 | 177 | 449 |
| R5-S2D2 checkpoint | 205 | 181 | 386 |
| Final R5 | 130 | 188 | 318 |

Final census: 379 scanned files, 94 files with DB calls, 132 server client
creation sites, 62 Supabase server imports, and 3 direct supabase-js imports.

Major bounded read models added during R5:

- Inventory/replenishment models from R5-S2.
- Management and Catalog workspace bundles.
- POS bootstrap, Dashboard readiness, and Reports store reference bundles.
- Receipt detail and Time Clock workspace bundles.

Atomic checkout, sales, payments, inventory command, transfer, purchasing,
count, offline/sync, and provider-neutral identity RPCs remain intentionally
unchanged where they are the correct security/atomicity boundary.

## Runtime and database certification

No benchmark numbers were invented: this repository has no comparable
pre-change runtime latency corpus. The request-level improvement is measured by
the documented consolidation of repeated ordinary read calls into bounded RPCs.
No speculative index was added.

The final local-only database certification passed:

- Local target safety preflight and clean local migration replay.
- 79 pgTAP database files / 1,688 tests.
- Canonical R5 chain through `0010` applied before the local Phase 14 browser
  integration gate.
- Database lint with zero errors.
- Local browser integration gate.

Application certification passed:

- Protected-core inventory ledger, idempotency, transfers, purchasing, counts,
  POS, checkout, receipt/refund, shift, RBAC, tenant/store, and offline/sync
  regression contracts.
- Root typecheck and mobile typecheck.
- ESLint with zero errors and three pre-existing warnings.
- Production build.
- Full static certification with 141 automated package-test commands.
- R5 final contract and static-census reproducibility contract.

## Security and safety

- Canonical R5 `SECURITY DEFINER`: `0`
- Canonical R5 provider auth-helper references: `0`
- Tenant/store isolation and RBAC/RLS weakened: `NO`
- Historical Supabase migrations modified: `NO`
- Pushed canonical migrations rewritten: `NO`
- Live Neon schema writes: `NO`
- Live Neon business-data writes: `NO`

## Source of truth

The locked recovery source of truth status is now: R5 `COMPLETE`; R5-S2 through
R5-S6 `COMPLETE`; R6 `NEXT / NOT STARTED`. No R6 work was started.
