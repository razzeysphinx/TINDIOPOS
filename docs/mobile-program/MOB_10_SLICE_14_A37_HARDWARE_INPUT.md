# MOB-10 Slice 14 — A37 hardware input resilience

Status: **A37 BLOCKED; verified implementation closure is complete, but physical HID reconnect evidence is unavailable**

Starting commit: `e0d0a5446edad0819f858e8b68f06faae14d03b3`

## Result

Camera denial and manual barcode/SKU fallback passed on the physical Android device. The denied-camera screen now explicitly tells the cashier that manual barcode and SKU entry remains available. Returning to the POS and submitting the existing cached certification SKU added exactly one cart line.

The camera callback and keyboard/HID submission paths now acquire synchronous single-flight guards before asynchronous catalog lookup. A repeated callback from one native scan cannot add a duplicate line while the first callback remains in flight. The guard is released after completion, so a later intentional scan remains accepted.

A real HID disconnect/reconnect was not executed. Android's input-reader state showed no external input device attached: every reported reader had `IsExternal: false`. Because A37 explicitly includes HID reconnect, the acceptance case remains **BLOCKED** until an external USB or Bluetooth HID scanner is available. This is an equipment limitation, not a source failure.

## Architecture decision

**KEEP + HARDEN.** The existing Expo Camera scanner, local SQLite barcode/SKU lookup, cart reducer, checkout engine, outbox, and server-authoritative financial path remain unchanged. This slice adds only an input-level concurrency guard and clearer permission-denial guidance.

The guard does not allocate or modify an event ID, idempotency key, device sequence, receipt, payment, inventory movement, or recovery record. It prevents duplicate UI acceptance before transaction authority is reached.

## Physical Android evidence

Device: Xiaomi 21121210G, Android API 34, arm64-v8a, serial `82eaaf10`, package `com.tindio.pos`.

The current source was bundled into a same-signer arm64 certification APK and installed with `adb install -r`. APK SHA-256: `3FDD717C722C518A8ED0ADD08B64AB9F74A8E1448E0D982632B91BC46519006D`. The package retained its original `firstInstallTime` of `2026-10-09 22:13:25`; no uninstall or app-data clearing occurred.

| Boundary | Physical observation |
|---|---|
| Starting readiness | `READY OFFLINE`; active shift matched this terminal |
| Starting custody | Receipt summaries 33; outbox pending/syncing/conflict/failed `0 / 0 / 0 / 0` |
| Camera denial | With `android.permission.CAMERA` revoked, the installed app displayed: `Camera permission is required only for camera barcode scanning. Manual barcode and SKU entry remains available in the POS.` |
| Manual fallback | `Back to POS` returned to an enabled `Barcode or SKU` field and `Find local barcode/SKU` control |
| Canonical fixture lookup | A read-only, rolled-back query against the validated canonical Neon target identified active SKU `PHASE04F-1790247666316`; it changed no data |
| Successful manual input | Submitting that cached SKU added `Phase 04F Certification Item` and changed `Cart lines: 0` to `Cart lines: 1` |
| One-scan duplicate boundary | The behavioral suite proves a second concurrent callback cannot acquire either production input guard; later intentional input succeeds after release |
| HID reconnect | **BLOCKED** — `dumpsys input` reported no external reader; no scanner was available to disconnect and reconnect |
| Ending custody | SQLite schema 13/13, integrity OK, receipt summaries 33, outbox `0 / 0 / 0 / 0`, oldest unresolved `NONE` |
| Permission restoration | Camera permission was restored after the denial test |

The cart was never tendered or accepted. No synthetic or merchant financial transaction was created by this slice.

## Security and transaction custody

Tenant, organization, employee, store, register, shift, and device scoping are unchanged. The catalog lookup remained bound to the current organization and store. The canonical product-code lookup used the repository's target validator plus a read-only Postgres transaction and rollback.

Existing receipts remained visible and outbox counts remained zero. No credential, synchronization cursor, checkout intent, recovery record, unresolved transaction, lease, or local database was reset or deleted.

## Compatibility

- SQLite/database: no schema or data migration.
- API: no request or response contract change.
- Camera: existing Expo Camera callback contract retained.
- HID/manual input: existing keyboard-wedge Enter behavior retained; concurrent duplicate callbacks are ignored only while the first lookup is in flight.
- Checkout/outbox: no contract or authority change.

## Validation

- A37 behavioral suite: **5/5 passed**.
- Phase 19 native hardware contract: **1/1 passed**.
- Mobile typecheck: **passed**.
- Root typecheck: **passed**.
- Root lint: **passed with three pre-existing warnings and zero errors**.
- Android export: **passed** (Hermes bundle generated).
- Same-signer arm64 release APK assembly and in-place install: **passed**.
- Physical camera-denial/manual-fallback/custody campaign: **passed**.
- Physical HID disconnect/reconnect: **BLOCKED — no external scanner attached**.
- Static certification: **passed** (151 automated package test commands; production build passed).
- `git diff --check`: **passed**.

## Acceptance result and remaining limitations

| Acceptance ID | Result | Reason |
|---|---|---|
| A37 | **BLOCKED** | Camera denial, manual fallback, duplicate suppression, and custody passed; mandatory physical HID reconnect remains unevidenced because no external scanner was available. |

This certification APK is not the Phase 23/24 production-signed release candidate. A48 remains **NOT_RUN**. MOB-10 and production certification remain open.

## Next smallest safe slice

When a USB or Bluetooth HID scanner is available, finish A37 by scanning one fixture code, disconnecting and reconnecting the scanner, scanning again, and proving each physical scan causes exactly one cart increment. Until then, the next independently executable MOB-10 slice is A38 printer disconnect/paper-out evidence if compatible printer hardware is available; otherwise record that equipment blocker and proceed to the next case that can be executed without falsifying physical evidence.
