# MOB-10 Slice 11 — A33 shift and device custody guards

Status: **A33 PASS; MOB-10 REMAINS OPEN**

Starting commit: `ea175476b105a43a6451f379c261160b45ebabf5`

## Result

A supported synthetic PHP 1.00 offline cash sale was accepted on the physical Android device as local event `021466ba-02f7-4471-9767-eb35e20f9de5`, idempotency key `813d8e74-7128-4d14-a95a-f825ab68574a`, provisional receipt `OFF-813D8E7471`, and device sequence 1110. While it remained `LOCAL_PENDING`, the app was stopped and its app-private SQLite files were streamed directly for read-only verification. The immutable receipt and outbox snapshots were both present, the server checkpoint remained 1109, and the unresolved count was one.

The physical app's Shift screen reported `Shift mutations are online only` and exposed a disabled Close Shift control while isolated. Separately, the real authenticated canonical RPC returned SQLSTATE `23514` for an ordinary shift-close attempt: `Shift close blocked while a device has active offline transaction custody.` A device-revocation attempt returned SQLSTATE `23514`: `This device has active offline shift custody. Reconcile and close the shift before reassigning or revoking it.` Read-only canonical assertions before and after proved that the open shift, device status and binding, active custody lease, server checkpoint, and all financial counts were unchanged.

After the normal connection was restored, a custody-preserving cold start entered `CLOUD_ONLINE` and the existing recovery coordinator reconciled the original transaction. The same local event, idempotency key, provisional receipt, and sequence became `SYNCED`; server checkpoint advanced to 1110; official receipt 1144 linked to the original immutable snapshot. Canonical Neon contained exactly one PHP 1.00 sale, payment, receipt, sale item, and `-1` inventory movement. This is both **DELIVERY/RECOVERY CORRECT** and **FINANCIAL SETTLEMENT SUCCESS**.

## Architecture decision

**KEEP.** Current source already implements A33 correctly:

- `apps/mobile/src/db/shift-custody.ts` counts every unresolved financial state and refuses finalization without deleting custody.
- `apps/mobile/src/features/shifts/prepare-shift-finalization.ts` runs intent recovery, the existing MOB-03 coordinator, checkpoint refresh, and the custody policy before creating a durable finalization guard.
- `apps/mobile/app/(app)/shift.tsx` does not call the close API until local preparation succeeds and disables shift mutations while offline.
- `database/migrations/0013_mobile_shift_custody_leases.sql` blocks ordinary close while any active device lease exists and uses one trigger for device store, register, or status changes.
- `src/features/devices/actions.ts` and `src/features/shifts/service.ts` retain the authenticated, permission-checked canonical RPC paths.

No mobile product behavior, SQLite schema, API contract, or canonical migration required a change. This slice adds only a bounded authenticated verification harness and certification evidence.

## Physical and canonical evidence

| Boundary | Observed result |
|---|---|
| Offline acceptance | Event `021466ba-02f7-4471-9767-eb35e20f9de5`; key `813d8e74-7128-4d14-a95a-f825ab68574a`; receipt `OFF-813D8E7471`; sequence 1110; PHP 1.00 cash |
| Local custody before attempts | `LOCAL_PENDING`, attempts 0, one unresolved event, next sequence 1111, checkpoint 1109, immutable receipt present |
| Physical Shift UI | `Shift mutations are online only`; Close Shift disabled; tapping it left the shift and local event unchanged |
| Canonical close guard | HTTP 400 / SQLSTATE `23514`; active-custody message; shift remained open |
| Canonical device guard | Revocation returned HTTP 400 / SQLSTATE `23514`; device stayed active on its original store/register |
| Atomic no-op proof | Lease remained `ACTIVE`; checkpoint remained 1109; financial counts remained 1111/1111/1111/1111/1116 |
| Final local state | Same identity `SYNCED`, attempts 1, sale `9efaf98d-b6de-49d9-a961-79546848a656`, receipt 1144, checkpoint 1110 |
| Final cloud state | One completed checkout, sale, payment, receipt, item, and inventory movement; sequence 1110 `APPLIED` |

The certification organization currently has only one active register. Therefore, a different valid reassignment target did not exist and the harness recorded that individual live sub-attempt as `NOT_RUN` instead of creating or mutating merchant fixtures. Live revocation exercised the same `before update of store_id, register_id, status` custody trigger. The existing behavioral suite separately proves that both reassignment and revocation are rejected by that shared trigger.

## Security and transaction custody

All server attempts used an authenticated certification identity and public permission-checked RPCs. There were no direct table writes. No app data was cleared, no APK was uninstalled, no SQLite row was edited, no database was reset, no custody row was deleted, and no transaction identity was replaced. The shift was not closed and the device was neither rebound nor revoked. Offline card/electronic payment remained disabled.

## Validation

- MOB-08 local finalization custody suite: **6/6 passed**.
- MOB-08 server custody lease suite: **6/6 passed**, including device reassignment and revocation.
- Phase 13 native cashier parity: **1/1 passed**.
- Phase 18 production failure contract: **1/1 passed**.
- Phase 25 device fleet: **5/5 passed**.
- Root typecheck: **passed**.
- Mobile typecheck: **passed**.
- Root lint: **passed with three pre-existing warnings and zero errors**.
- Mobile lint: **passed with one pre-existing warning and zero errors**.
- Android export: **passed** (29 generated files; Android Hermes bundle metadata present).
- Static certification: **148/149 passed**; only `test:phase-04-docker-source-connectivity` failed because the local Supabase source was unavailable. Canonical historical migration integrity and R9 checks passed.
- Final `git diff --check`: **passed**.

## Compatibility and limitations

Database, SQLite, and API compatibility are unchanged. This slice used the existing development/certification APK. It does not certify production signing, Google Play delivery, 16 KB-page hardware, peripherals, every remaining MOB-10 case, or merchant-pilot readiness. `A48` remains **NOT_RUN** until the real Phase 23/24 production release candidate exists.

## Next smallest safe slice

MOB-10 Slice 12 should execute A34 as a separate multi-device shift-custody campaign. It requires a second enrolled physical terminal (or an explicitly approved equivalent physical fixture) on the same shift so final drawer accounting can be proven while that other device still holds pending cash. Do not start A48 or MOB-11 in that slice.
