# Post-R9 organization lifecycle inventory

Captured: 2026-10-05  
Guarded base: `040cd43feaafc80763208f4b000b677040fd0f3d`  
Design branch: `post-r9/certification-tenant-archive-design`

## Decision gate: REUSE EXISTING

No new lifecycle migration is required. The canonical baseline and the
read-only authoritative Neon inspection agree on the existing generic
lifecycle:

- `public.organizations.status` is constrained to `active`, `suspended`, or
  `archived`, defaulting to `active`.
- `suspended_at`, `suspension_reason`, `archive_requested_at`,
  `archive_requested_by_employee_id`, and `archived_at` exist already.
- `organizations_archived_at_requires_archived_status` prevents an archived
  timestamp from drifting from `status`.
- `public.manage_organization_lifecycle(uuid,text,text)` delegates to the
  hardened private implementation. Archive requires a prior request and a
  fresh delivered export; it archives metadata only and writes an audit event.
- The public lifecycle RPC is available only to `tindio_authenticated`; its
  security-definer implementation uses an empty `search_path` and applies
  owner/permission checks.

## Authoritative write boundary

`private.assert_organization_operational()` is a security-definer trigger
function with an empty `search_path`, revoked from `PUBLIC`. It rejects any
insert, update, or delete whose tenant is not `status = 'active'` with SQLSTATE
`42501`. The canonical baseline has 156 operational-guard trigger occurrences
across tenant business relations, including sales, shifts, cash, catalog,
inventory, transfers, returns, purchasing, workforce, and configuration.

RLS helpers continue to provide historical/read authorization independently;
the lifecycle trigger is the final write boundary. No RLS policy or Data API
grant was widened for this work.

## Identity and selection path

Supabase supplies authentication only. At request time the server verifies the
Supabase user, loads active employee memberships, reads matched organizations,
and uses the HttpOnly `tindio-active-organization` cookie as an untrusted
requested ID. The selector is served by `loadBusinessContext`; operational
routes call `requireBusinessContext` and redirect lifecycle-paused contexts to
`/organization-paused`.

The inventory found one application gap: the selector exposed archived and
suspended memberships, and the server action could write their ID to the
active-organization cookie. The local change filters the normal selector to
active organizations and re-reads `organizations.status = 'active'` in the
server action before writing the cookie. A stale paused ID falls back only to
an existing active membership; a user with no active memberships is kept in
the non-operational paused state.

## Immutable inventory history

`private.guard_inventory_count_line_lifecycle()` is bound to
`public.inventory_count_lines` by
`inventory_count_lines_guard_terminal_document`. It rejects changes to a
`posted`, `completed`, or `cancelled` parent with SQLSTATE `23514` and the
message recorded by the failed-delete evidence. The companion document guard
remains in place on `public.inventory_counts`. Neither function nor trigger is
modified by this design.

## Read-only live confirmation

The canonical Neon target inspected read-only was
`divine-sound-41148108` / `br-snowy-heart-b5nf6q3n` /
`tindio_r6_recovery`. Its organization columns, constraints, policies, central
operational guard, and immutable inventory triggers matched the canonical
baseline. The certification and RAZZEY organizations each existed exactly once
and were active at inspection. No production query mutated data.

