# Organization archive/deactivation design

## Chosen model

Reuse the existing generic `public.manage_organization_lifecycle` workflow.
It is the authoritative archival primitive; no tenant name or UUID appears in
database enforcement. `ARCHIVE` is non-destructive: it requires a prior
archive request and fresh export evidence, records an audit event, and changes
only organization lifecycle metadata to `status = 'archived'` with
`archived_at` set.

Archived organizations retain their membership, profile and Supabase Auth
identity, business history, audit history, terminal inventory counts, and
export/recovery evidence. They cannot pass the operational trigger guard and
cannot be selected as an active organization by the application.

## Application hardening

- `loadBusinessContext` now separates all membership records from the normal
  operational selector. Only active organizations are returned as selectable.
- A stale suspended or archived cookie does not select that tenant
  operationally. An active membership is selected deterministically when one
  exists; otherwise the existing paused route remains the safe no-active-org
  state.
- `setActiveOrganization` rechecks the selected organization lifecycle in the
  server action before it writes the HttpOnly cookie. This protects direct
  Server Action requests as well as UI interaction.
- The database remains the authority for crafted REST/RPC/table mutations;
  application gating does not replace RLS or the operational trigger.

## Future production archive runbook (design only)

1. Obtain separate explicit execution approval and re-verify the canonical
   Neon project, branch, database, exact target UUID/name/fingerprint, control
   tenant, lifecycle states, membership/identity links, 103-table count
   summary, terminal inventory counts, and Supabase Auth identity.
2. Deploy this already-tested application hardening through the approved
   release path and prove the existing lifecycle/trigger guard is active.
3. Perform the lifecycle workflow for the exact target only: request archive,
   prepare and record a fresh export, then call `ARCHIVE` in a locked,
   auditable transaction after all exact preconditions pass.
4. Assert a single organization metadata row changed. Do not delete business
   rows, employees, profiles, identity links, Auth users, or resources.
5. Run rollback-safe negative write probes and read-only RAZZEY checks; compare
   all pre/post business-history and terminal inventory counts/hashes.
6. If a severe regression requires rollback, restore captured lifecycle
   metadata only. Never rewrite business history or bypass immutability.

This document authorizes no production action.

