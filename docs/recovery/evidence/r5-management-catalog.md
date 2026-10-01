# TINDIO R5 Management + Catalog Read Consolidation

Branch: `recovery/neon-canonical-rebuild`

Checkpoint: `R5 Management + Catalog`

## Read-path result

The R5-S2D2 static census recorded 27 direct `.from()` reads in
`management/data.ts` and 11 in `catalog/data.ts`. This checkpoint moves their
ordinary workspace/reference reads to two bounded, provider-neutral canonical
RPCs:

- `public.get_management_workspace_bundle_v1`
- `public.get_catalog_workspace_bundle_v1`

Both functions are `STABLE`, `SECURITY INVOKER`, use a safe search path, revoke
`PUBLIC` execution, and grant only `tindio_authenticated`.

| Surface | Before direct `.from()` | After direct `.from()` | Retained semantic RPCs |
| --- | ---: | ---: | --- |
| Management data | 27 | 0 | Customer-display sessions, shift operational summary, employee detail |
| Catalog data | 11 | 0 | Permission-sensitive catalog costs |

The two read-model wrappers each contain one canonical RPC call site and no
direct table query. Application-side transformations and capability/store-scope
checks remain at their existing feature boundary.

The regenerated R5 census records 167 `.from()` calls, 183 `.rpc()` calls, and
350 total static DB call sites across 376 scanned files. The increase in
bounded RPC calls is intentional: it replaces repeated workspace reads without
combining independent commands or weakening RLS.

## Certification

The following passed locally:

- Management/Catalog static contract and local reset/replay through migration
  `0008`, including both zero-UUID function smokes and database lint.
- Management/Catalog, inventory RBAC, multi-store, and provider-neutral
  authorization regressions.
- Root typecheck and mobile typecheck.
- ESLint with zero errors and three pre-existing warnings.
- Production build.
- Full repository static certification (138 automated package test commands).
- Regenerated R5 census and reproducibility contract.

## Safety

- Live Neon schema writes: `0`
- Live Neon business-data writes: `0`
- Historical Supabase migrations modified: `0`
- Pushed canonical migrations 0002 through 0007 rewritten: `0`
- Tenant/store isolation, RLS, RBAC, idempotency, and service-worker boundaries:
  unchanged.
