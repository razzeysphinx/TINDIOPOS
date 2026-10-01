# TINDIO R5 POS + Dashboard + Reports Read Consolidation

Branch: `recovery/neon-canonical-rebuild`

Checkpoint: `R5 POS + Dashboard + Reports`

## Read-path result

This checkpoint moves ordinary POS bootstrap reference data, Dashboard setup
readiness counts, and the Reports store reference list behind bounded canonical
invoker functions:

- `public.get_pos_bootstrap_bundle_v1`
- `public.get_dashboard_readiness_snapshot_v1`
- `public.get_reports_store_reference_v1`

| Surface | Before direct `.from()` | After direct `.from()` | Intentionally retained |
| --- | ---: | ---: | --- |
| POS support workspace | 12 | 1 | Dynamic product-modifier lookup and bounded semantic POS RPCs |
| Dashboard setup readiness | 6 | 0 | Dashboard operational snapshot RPC |
| Reports store reference | 1 | 0 | Scoped reporting snapshot calculations |

The remaining POS direct read is dependent on the dynamic catalog result set;
folding it into the bootstrap bundle would over-fetch modifiers. Customer
display, attendance, transfer inbox, catalog search, favorites, recent items,
open tickets, ticket assignees, and receipt contracts remain specialized RPCs.

Each new function is `STABLE`, `SECURITY INVOKER`, uses a safe search path,
revokes `PUBLIC`, and grants execution only to `tindio_authenticated`.

The regenerated R5 census records 149 `.from()` calls, 186 `.rpc()` calls, and
335 total static DB call sites across 377 scanned files. The bounded RPC count
increase is intentional and replaces repeated ordinary read round-trips.

## Certification

The following passed locally:

- POS/Reporting static contract and canonical recovery-chain replay through
  migration `0009`, including zero-UUID function smokes and database lint.
- POS workspace, cashier, negative-stock, incoming-transfer, POS V2 API and
  boundary regressions.
- Dashboard access, business reports workspace, and shift audit report checks.
- Root typecheck and mobile typecheck.
- ESLint with zero errors and three pre-existing warnings.
- Production build.
- Full repository static certification (139 automated package test commands).
- Regenerated R5 census and reproducibility contract.

## Safety

- Live Neon schema writes: `0`
- Live Neon business-data writes: `0`
- Historical Supabase migrations modified: `0`
- Pushed canonical migrations 0002 through 0007 rewritten: `0`
- Tenant/store isolation, RLS, RBAC, idempotency, POS API, and mobile contracts:
  unchanged.
