# MOB-10 Slice 7 — A29 expired-cursor resnapshot

Status: **A29 PASS; MOB-10 REMAINS OPEN**

Starting commit: `119c66cd5e18a8e592cff107019b7f61462388e2`

This slice proves on a physical Android device that a delta cursor older than the canonical Neon retention boundary is rejected and repaired through a controlled, authenticated resnapshot. The repair replaces only server-derived cache rows and advances the cursor atomically. It does not reset SQLite or delete credentials, receipts, checkout custody, outbox entries, recovery records, or device-sequence state. A48 remains `NOT_RUN`.

## Architecture decision

The decision is **EXTEND** the existing POS v2 delta protocol and **KEEP + HARDEN** the existing MOB-03 coordinator and SQLite cache.

- `pull` returns typed HTTP 409 `SYNC_CURSOR_EXPIRED` when the requested cursor predates the retained boundary.
- `resnapshot` authenticates the same employee/device/store context and returns the canonical catalog and reference snapshot.
- Mobile applies catalog, observed-customer cache, modifiers, reference data, and the replacement cursor in one exclusive SQLite transaction.
- Reconciliation remains push-first. Outbox, device sequence, checkout intents, receipts, recovery records, and custody guards are outside the replacement set.
- Retention pruning is owner-only. Runtime roles can read through the authenticated API but cannot invoke maintenance.

## Physical A29 evidence

The device began with cursor 653, one cached product, eight cached receipt summaries, next device sequence 7, server checkpoint 6, zero unresolved transactions, and outbox `0/0/0/0`.

The dedicated synthetic product `d9a4ebe5-bfb8-46a6-8e83-013fe1be2ed1` was restored through the canonical authenticated `set_catalog_product_archived_safely` RPC, creating revision 728. The owner-only retention function then moved the certification tenant boundary to 728 and removed its obsolete delta rows. No other tenant rows existed, and financial custody remained eight sales, eight payments, eight receipts, and twelve inventory movements.

| Boundary | Physical result |
|---|---|
| Expired pull | Device cursor 653 was below retained boundary 728. Manual production reconciliation completed with 0 ACKs and 2 pull pages, advanced to cursor 738, and reported no sync error. |
| Controlled replacement | Catalog changed atomically from one to two items. Receipt summaries remained eight, outbox remained `0/0/0/0`, unresolved transactions remained zero, and sequence remained 7/checkpoint 6. |
| Local catalog proof | POS showed `MOB-10 A28 Delta Fixture v2 — ₱2.00` from SQLite alongside the existing certification item. |
| Process death | Force-stop and cold restart retained two catalog items, cursor 738, eight receipt summaries, zero unresolved transactions, and sequence 7/checkpoint 6. |
| Cleanup by normal delta | The fixture was archived through the canonical authenticated RPC. Normal reconciliation used one pull page, advanced cursor 738 to 754, and returned the local catalog to one item without another replacement. |
| Final canonical state | Fixture archived; retained boundary 728; eight sales, eight payments, eight receipts, and twelve inventory movements unchanged. |

The device remained `READY OFFLINE`, `CLOUD_ONLINE`, SQLite schema `13/13`, and SQLite integrity `OK`. It was not uninstalled, cleared, reset, or manually edited. Machine-readable evidence is in `evidence/MOB_10_SLICE_07_A29_EXPIRED_CURSOR_RESNAPSHOT.json`.

## Compatibility and security impact

- Database: forward migration `0016_mobile_sync_retention_resnapshot.sql`; canonical Neon installation verified. No business or financial table migration.
- SQLite: no schema change. Resnapshot is a scoped transaction over replaceable cache tables only.
- API: additive typed 409 response and additive `/api/pos/v2/sync/resnapshot` route; normal delta consumers remain compatible.
- Tenant/store security: both routes validate the current organization, employee, device, store, and register context. Mobile rejects scope/boundary mismatches before mutation.
- Custody: no outbox, receipt, sequence, checkout-intent, recovery, credential, or unresolved-transaction deletion path is present in the resnapshot transaction.

## Validation

- A29 behavioral suite: 4/4 passed.
- Phase 12 delta reconciliation check: passed.
- Provider-neutral inventory authorization and canonical installation checks: passed.
- Mobile typecheck and root typecheck: passed.
- Focused ESLint and `git diff --check`: passed.
- Android export: passed.
- Static certification: an earlier run passed 145/145 automated package commands, including the production build. The final-tree rerun passed 144/145; only the unrelated `test:phase-04-docker-source-connectivity` environment prerequisite failed because the local Supabase source was unavailable. Every A29 and affected mobile/recovery check passed.
- Physical APK: `C:\tmp\TINDIOPOS-MOB10-A29-resnapshot-lan8.apk`, SHA-256 `8DD2A72C3E36783D69B902C775CBA7074E94F7B16D79D8ECE573B0D09DD4B4BD`.

## Remaining limitations

A29 does not certify A48, production signing, Google Play delivery, peripherals, every remaining MOB-10 failure scenario, or merchant-pilot readiness. A48 remains `NOT_RUN` until the Phase 23/24 release candidate exists.
