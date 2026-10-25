# Phase G4 supported-client and forced-upgrade boundary

Status: **IMPLEMENTED; PRODUCTION ACTIVATION NOT AUTHORIZED**  
Recorded: **2026-10-25**  
Branch: **TINDIO-PREPRODUCTION**

## Outcome

TINDIO now has a provider-neutral client compatibility contract for the Auth
transition. Mobile requests identify their application version, selected Auth
provider, and supported transition/custody capabilities. This is declaration
and enforcement groundwork only: no deployed route is switched to Neon and no
production compatibility window is closed by this slice.

The policy has three explicit modes:

| Mode | Legacy client | Transition-capable client |
| --- | --- | --- |
| `supabase-compatibility` | Selling and recovery remain available through Supabase. | Selling and recovery remain available through Supabase. |
| `dual-transition` with open legacy window | Selling and recovery remain available through Supabase. | Selling and recovery remain available during the controlled transition. |
| `neon-required`, or closed legacy window | New selling is denied with HTTP 426; custody recovery remains available. | Selling is allowed subject to normal Neon identity and authorization checks. |

An old client denied by the policy receives
`POS_CLIENT_UPGRADE_REQUIRED`, `retryable: false`, and
`preservesRecovery: true`. Unknown or absent capabilities never impersonate a
current client.

## Mobile safety correction

The mobile HTTP adapter recognizes the structured 426 response. The sign-in
and protected reauthentication paths retain the freshly established provider
session, evaluate existing offline readiness, and show the server's upgrade
message. They do not call provider sign-out from the forced-upgrade branch.

Business-context refresh attempts to load the existing offline snapshot and
continues to expose the upgrade message. This preserves the existing controls
for offline authorization, pending outbox work, receipts, device sequence, and
shift custody; it does not create a bypass for new online mutations.

## Rollback boundary

- Production remains Supabase-default and Neon-disabled.
- The legacy Supabase storage key remains intact.
- Closing the supported-client window requires a separate approved deployment.
- A cutover rollback changes the server/client provider selector back to
  Supabase; it must not clear provider sessions or local financial state.
- Recovery operations must remain reachable for a blocked client until its
  local custody is reconciled or explicitly resolved under the existing loss
  policy.

## Evidence

- `packages/contracts/src/auth-client-compatibility.ts`
- `apps/mobile/src/lib/tindio-api.ts`
- `apps/mobile/src/features/session/session-provider.tsx`
- `apps/mobile/src/features/business/business-context-provider.tsx`
- `scripts/architecture-phase-g-client-compatibility-check.mjs`
- `pnpm test:architecture-phase-g-client-compatibility`
- `pnpm contracts:typecheck`
- `pnpm mobile:typecheck`

Physical old-client, fresh-install, in-place-upgrade, and rollback campaigns
remain required against the signed release candidates. Source tests are not a
substitute for those campaigns.
