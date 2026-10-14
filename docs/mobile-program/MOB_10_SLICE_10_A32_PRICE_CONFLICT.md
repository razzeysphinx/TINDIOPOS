# MOB-10 Slice 10 — A32 price-conflict recovery

Status: **A32 PASS; MOB-10 REMAINS OPEN**

Starting commit: `0d9893c3c687ad11132cf007549cf7b10957f589`

## Result

A supported synthetic offline cash sale was accepted on the physical Android device at the cached PHP 1.00 price. It entered durable custody as local event `3ff36c65-d1b1-4905-8b36-62c605a79716`, idempotency key `757644b2-b619-41ab-84b6-6ee11b3ca03e`, provisional receipt `OFF-757644B2B6`, and device sequence 1109.

After local acceptance, the Certification Store price override was changed to PHP 2.00 through the authenticated canonical catalog RPC. The mutation produced a canonical `PRODUCT_STORE_CONFIGURATION_UPDATED` audit event and did not change any sale, payment, receipt, sale-item, or inventory-movement count. Normal delivery through POS v2 then rejected the queued sale as `CONFLICT / PRICE_CHANGED` with the message `This queued sale total changed while offline. Review the sale before recording it.` The authoritative financial counts remained unchanged, so the conflict did not silently create or reprice a sale.

The store price was restored to its normal PHP 1.00 value through the same authenticated and audited RPC. A currently authorized manager reviewed the preserved transaction, entered `A32 price restored after audited review`, and selected **Retry original transaction**. Recovery reused the existing MOB-03 coordinator and original identity. Canonical Neon then contained exactly one PHP 1.00 sale, one PHP 1.00 cash payment, one receipt, one PHP 1.00 sale item, and one `-1` sale inventory movement. The original offline event was `SYNCED`, its sequence receipt was `APPLIED`, and official receipt 1143 was linked to the unchanged local snapshot.

This is both **DELIVERY/RECOVERY CORRECT** and **FINANCIAL SETTLEMENT SUCCESS**.

## Architecture decision

**KEEP.** Current source already implements the required A32 behavior:

- `src/features/checkout/checkout-service.ts` sends the accepted local total as an immutable offline-total marker and maps the server mismatch to `PRICE_CHANGED`.
- `private.guard_offline_checkout_total` and `private.guard_offline_payment_total_marker` recompute the current authoritative checkout and reject a mismatched obligation before the database transaction can commit.
- `apps/mobile/src/features/outbox/outbox-sync.ts` retains the server rejection as a visible, non-terminal conflict.
- `apps/mobile/src/features/outbox/recovery-policy.ts` requires current manager authority for conflict recovery and revalidates tenant, store, employee, device, register, and checkout scope.
- `apps/mobile/src/db/outbox.ts` returns the same row to `LOCAL_PENDING` and writes `outbox_recovery_actions` in one SQLite transaction.
- `apps/mobile/src/features/outbox/outbox-recovery.ts` retries through the existing single-flight MOB-03 coordinator.

No application behavior, SQLite schema, API contract, or canonical database migration needed replacement or extension. The slice adds only a bounded canonical verification harness, focused regression coverage, and acceptance evidence.

## Physical evidence

| Boundary | Observed result |
|---|---|
| Prepared offline acceptance | `OFF-757644B2B6`, local event `3ff36c65-d1b1-4905-8b36-62c605a79716`, key `757644b2-b619-41ab-84b6-6ee11b3ca03e`, sequence 1109, PHP 1.00 cash |
| Controlled catalog change | Store override changed from null to 200 minor units at `2026-10-13T13:22:23.191001Z`; canonical audit recorded the product and value |
| Conflict delivery | `CONFLICT / PRICE_CHANGED`; original receipt, amount, payload, event identity, idempotency key, and sequence remained present |
| No false financial success | Counts stayed at sales 1110, payments 1110, receipts 1110, sale items 1110, inventory movements 1115 |
| Controlled restoration | Store override restored to null at `2026-10-13T13:40:17.550092Z`; a second canonical audit recorded the restoration |
| Manager resolution | Same event received one `RETRY_AUTHORIZED` audit with prior state `CONFLICT`, prior type `PRICE_CHANGED`, and the supplied review reason |
| Final local state | `SYNCED`, attempts 2, server sale `7487b152-c8c2-4d0a-8e04-ee2bb4568f48`, official receipt 1143 |
| Final cloud state | offline event `SYNCED`, sequence 1109 `APPLIED`, one authoritative checkout and financial effect |

After the app process was stopped, a direct read-only copy streamed from the app-private sandbox confirmed that the SQLite row, local receipt, device sequence, recovery audit, and official link remained durable. The outbox snapshot and local-receipt snapshot had the identical SHA-256 `7551fc95c110e140f0d09d706b9513d057e3abd60877767ea6a4770649b539a8`.

## Canonical database assertions

For idempotency key `757644b2-b619-41ab-84b6-6ee11b3ca03e`:

- one completed advanced checkout request and sale `7487b152-c8c2-4d0a-8e04-ee2bb4568f48`;
- sale total PHP 1.00, not the temporary PHP 2.00 catalog value;
- one PHP 1.00 cash payment;
- one receipt, number 1143;
- one sale item with a PHP 1.00 line total;
- one sale inventory movement with quantity delta `-1`;
- one `SYNCED` offline event retaining `OFF-757644B2B6`;
- one sequence-1109 receipt in `APPLIED` state.

Final organization-wide counts were exactly one above the pre-delivery baseline: sales 1111, payments 1111, receipts 1111, sale items 1111, and inventory movements 1116. There was no duplicate financial or inventory effect.

## Security and custody impact

The price mutation and restoration used the existing authenticated, permission-checked canonical RPC; both produced audit records. The cashier identity could not perform the catalog mutation, while the authorized manager identity could. Conflict recovery required current `sales.refund` manager authority in addition to the normal tenant, assigned-store, device, register, and checkout validations.

No app data was cleared, no APK was uninstalled, no SQLite row was edited, no local database was reset, no custody row was deleted, and no transaction identity was replaced. The provisional receipt and original PHP 1.00 cash obligation remained readable throughout review. Offline electronic/card payments remained disabled.

## Validation

- Focused A32, receipt, Phase 02/10/12/17/18, and recovery suites: **37/37 passed**.
- Root typecheck: **passed**.
- Mobile typecheck: **passed**.
- Root lint: **passed with three pre-existing warnings and zero errors**.
- Mobile lint: **passed with one pre-existing warning and zero errors**.
- Android export: **passed**.
- Static certification: **148/149 passed**; only `test:phase-04-docker-source-connectivity` failed because the local Supabase source was unavailable. Canonical historical migration integrity and R9 checks passed.
- `git diff --check`: recorded after evidence finalization.

## Compatibility and limitations

Database, SQLite, and API compatibility are unchanged. This slice used the existing development/certification APK and does not certify production signing, Google Play delivery, 16 KB-page hardware, peripherals, every remaining MOB-10 case, or merchant-pilot readiness. It exercised one supported price-change conflict; the existing source contracts cover the related tax, product-availability, and payment-policy classifications, but their remaining physical campaigns are not claimed here.

`A48` remains **NOT_RUN** until the real Phase 23/24 production release candidate exists.

## Next smallest safe slice

MOB-10 Slice 11 should execute A33: attempt shift close and device reassignment while local money is unresolved, proving the unsafe action is blocked or explicitly reconciled without stranding cash. A34 should follow as its separate multi-device shift-custody campaign. Do not start A48 or MOB-11 in that slice.
