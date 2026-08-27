# TINDIO Final Pre-Production — Phase 8 Offline, Device & Sync Integrity Assessment

## Scope completed

Phase 8 verifies the existing offline POS workflow without replacing its checkout, sync, Supabase, RLS, or device-management architecture.

## Audit result

- Offline sales are stored durably in browser IndexedDB under a signed-in employee scope and keyed by the permanent checkout UUID.
- Reconnect and a two-second automatic retry loop use one active synchronization operation per scope and preserve queue order.
- The offline endpoint uses the authenticated business context, the existing authoritative checkout RPC, and the server-side offline-total guard.
- A previously unvalidated telemetry association was found: `record_offline_sync_event` checked only that its submitted shift/device belonged to the organization. A same-organization shift or device from another register could therefore appear in the manager audit history.

## Implemented integrity control

Migration `20260827152628_phase_8_offline_sync_binding_integrity.sql` replaces only the existing telemetry RPC implementation. It now requires every supplied shift to match the submitted organization, store, register, and authenticated employee, and every supplied device to match the submitted organization, store, and register.

The function remains a `security definer` routine with an empty search path and authenticated-only execution. No new table, RLS policy, permission model, paid infrastructure, or checkout path was added.

## Automated evidence — 2026-08-27

- `npm run test:offline-integrity`: 5 passed.
- Focused offline pgTAP suite (`improvement_13_offline_sync_foundation.test.sql`): 36 passed.
- Full local pgTAP suite: passed.
- Local Supabase database advisor at error level: no issues.
- `npm run typecheck`: passed.
- `npm run lint`: no errors; one pre-existing `no-img-element` warning remains in `src/app/(back-office)/back-office/catalog/page.tsx`.
- `npm run build`: passed.

The warning-level database advisor reports pre-existing warnings in older catalog/CSV helper functions. The Phase 8 migration did not add an advisor warning.

## Manual quality-assessment checklist

Run this in a browser against a non-production environment before release:

1. Sign in as a cashier with an open register shift and an enrolled device.
2. Disconnect the network, complete an eligible cash sale, and confirm `Offline • N pending` appears.
3. Refresh the POS and reopen it; verify the pending record and its temporary receipt reference remain.
4. Reconnect without pressing any button; verify the queue moves through `Syncing` and receives one official receipt.
5. Retry the same queued sale through a refresh/reconnect sequence; verify exactly one sale, payment, inventory movement, and receipt in Back Office.
6. Confirm a revoked or replaced device produces a manager-review state and cannot silently post under a different device identity.
7. Confirm `⚠ Sync Problem` is displayed for terminal conflicts and that `Retry after resolving` and `Sync now` remain available as supplementary controls.

## Known limitations and release risk

- Browser IndexedDB durability, browser-crash recovery, and real network transitions require the manual checklist above; they are not reproducible in this headless database suite.
- The synchronization outcome telemetry is intentionally non-authoritative after checkout: if it cannot be recorded, the checkout remains authoritative and its idempotency key prevents a duplicate business outcome.
- Historical manager telemetry with null shift/device remains valid. New non-null telemetry is now strictly store/register/employee-bound.

## Recommendation

Phase 8 is ready for the required manual quality assessment. Stop here; do not begin Phase 9 until the offline/reconnect checklist has been accepted.
