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

## Physical campaign preflight

The dated G4-01 campaign is recorded in
`docs/architecture/TINDIO_PHASE_G4_RELEASE_CAMPAIGN_PROOF.json`. A signed
development candidate from exact source commit `0eebdcb` advanced Android
version code `2` to `3` under the same package and signing certificate. The
physical in-place upgrade retained the original install identity and app-data
inode. The built-in proof then verified the active Auth session, device
enrollment, offline grant, unsynced event, receipt custody, sequence checkpoint,
and SQLite schema `13` to `13`.

The supported-old-client and versioned in-place-upgrade legs pass. The physical
fresh-install, forced-upgrade-426, and provider-rollback legs remain open, so
G4-01 is in progress rather than closed.

The current physical device retains the G3-certified custody state. A G4 fresh
install must use a disposable device/emulator or receive explicit approval to
remove the exact `com.tindio.pos` application data on that device. The preflight
does not uninstall, clear data, close the compatibility window, or change
production.

Run the reusable gate with explicit artifact paths:

```powershell
$env:PHASE_G4_OLD_CLIENT_APK = '<old-client.apk>'
$env:PHASE_G4_RELEASE_CANDIDATE_APK = '<newer-release-candidate.apk>'
pnpm preflight:phase-g4:release-campaign
```
