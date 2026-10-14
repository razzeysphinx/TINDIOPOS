# MOB-10 Slice 13 — A36 unsupported offline carts

Status: **A36 PASS; MOB-10 REMAINS OPEN**

Starting commit: `ce45f4c121b72c62f8d86440e4d420afd82dd2d2`

## Result

Unsupported offline cart state now resolves to an explicit cashier-facing restriction before payment. The POS names the blocking feature and instructs the cashier to reconnect or remove it. The offline-save handler repeats the same validation before durable acceptance, while `createOfflineCashSale` retains its independent fail-closed line validation before transaction identities are allocated.

The shared behavioral policy rejects customer, open-ticket, dining, variable/manual-price, modifier-ID, modifier-snapshot, item-note, and invalid-quantity state. Offline electronic/card payment still has no registered provider and remains fail closed. Tickets remain online-only (and are additionally disabled when the current feature/permission context does not expose them).

## Architecture decision

**KEEP + HARDEN.** The existing cash-only durable outbox, checkout service, payment-provider boundary, and online ticket/customer contracts remain unchanged. This slice only makes the existing eligibility boundary explain its exact reason and gives the save handler a defensive early return with the same message.

No second checkout engine, outbox operation, payment provider, SQLite table, API route, or database migration was introduced.

## Physical Android evidence

Device: Xiaomi 21121210G, Android API 34, arm64-v8a, serial `82eaaf10`, package `com.tindio.pos`.

The current source was bundled into a same-signer arm64 certification APK and installed with `adb install -r`. Final APK SHA-256: `21E6BB8EE919589B58B9F17CC839EFB12AC534E388B74AE4130207700644A827`. The package retained its original `firstInstallTime` of `2026-10-09 22:13:25`; no uninstall or app-data clearing occurred.

| Boundary | Physical observation |
|---|---|
| Starting readiness | `READY OFFLINE`, `DEVICE_ISOLATED`, SQLite schema 13/13, integrity OK |
| Starting custody | Receipt summaries 33; outbox pending/syncing/conflict/failed `0 / 0 / 0 / 0` |
| Supported control | Existing cached Phase 04F item formed a PHP 1.00 cart with `READY OFFLINE` |
| Unsupported pre-payment state | Synthetic line note `A36_UNSUPPORTED_NOTE` produced `Item notes require connectivity. Reconnect before collecting payment.` |
| Payment boundary | With exact PHP 1.00 tender and PHP 0.00 change, `Save offline cash sale` remained disabled |
| Card/electronic boundary | `DISABLED — NO COMPLIANT PSP STORE-AND-FORWARD ADAPTER`, registered providers 0, default policy `FAIL CLOSED` |
| Ticket boundary | Physical ticket route reported `Tickets disabled by feature or permission.`; source policy also requires online mode |
| Ending custody | Receipt summaries remained 33; outbox remained `0 / 0 / 0 / 0`; SQLite integrity remained OK |

The certification store had zero observed cached customers and its single product had no modifier configuration. This slice did not create canonical merchant fixtures merely to force those UI variants. Instead, the behavioral suite executes the exact customer and both modifier representations through the same shared production validator. The physical note scenario exercises the same cashier warning, disabled-payment control, and no-outbox boundary on the installed app.

## Security and transaction custody

The physical scenario created no event ID, idempotency key, device sequence, receipt, sale, payment, or inventory movement because rejection occurred before acceptance. Existing receipts remained visible, outbox counts remained zero, and the prepared authorization remained ready. No credential, cursor, checkout intent, recovery record, lease, or unresolved transaction was reset or deleted.

Offline electronic/card payments remain disabled until a real compliant provider is selected. Tenant, organization, employee, store, register, shift, and device scoping are unchanged.

## Compatibility

- SQLite/database: no schema or data change.
- API: no request or response contract change.
- Outbox: `SALE_COMPLETED` remains the only operation type; unsupported state cannot enqueue it.
- Existing supported offline cash carts: unchanged.
- Online customer, modifier, dining, ticket, and checkout behavior: unchanged.

## Validation

- A36 behavioral suite: **11/11 passed**.
- Phase 10 durable outbox: **1/1 passed**.
- Phase 13 native cashier parity: **1/1 passed**.
- Phase 20 offline payment risk: **5/5 passed**.
- Mobile typecheck: **passed**.
- Root lint: **passed with three pre-existing warnings and zero errors**.
- Android export: **passed** (Hermes bundle generated).
- Same-signer arm64 release APK assembly: **passed**.
- Physical in-place install and runtime campaign: **passed**.
- Static certification: **149/150 passed**; only the pre-existing environment-dependent `test:phase-04-docker-source-connectivity` check failed because the local Supabase source was unavailable. Canonical migration integrity and R9 checks passed.
- `git diff --check`: **passed**.

## Deferred cases and limitations

`A34` and `A35` remain **NOT_RUN**, not failed, because both require a second physical terminal and only one was available. This certification APK is not the Phase 23/24 production-signed release candidate. `A48` remains **NOT_RUN**. MOB-10 and production certification remain open.

## Next smallest safe slice

MOB-10 Slice 14 should execute A37 on the available physical device: deny camera permission, prove manual barcode/SKU entry remains available, exercise HID disconnect/reconnect if the available hardware permits it, and prove one scan cannot add a duplicate cart acceptance. Do not start A48 or MOB-11 in that slice.
