# MOB-10 Slice 8 — A30 queued-operation scale

Status: **A30 PASS; MOB-10 REMAINS OPEN**

Starting commit: `f0305e7f99f8a751fe6bcfc1267e91b02cc0e2ac`

This slice proves on a physical Android device that 100 and 1,000 synthetic offline cash sales retain durable identities and reconcile through the production outbox path with exact authoritative financial and inventory effects. No SQLite row was manually edited, no app data was cleared, and the app was never uninstalled. A48 remains `NOT_RUN` until the Phase 23/24 production release candidate exists.

## Architecture decision

The decision is **KEEP + HARDEN** the existing MOB-03 coordinator, **EXTEND** the non-production certification surface, and **NEW** a forward-only sequence-receipt repair migration.

- The certification harness exists only when a non-production build explicitly embeds `MOB10_A30`.
- It accepts only the certification organization and product, a prepared isolated terminal, an empty unresolved queue, and the fixed counts 100 or 1,000.
- Every synthetic sale uses `createOfflineCashSale`; the harness never inserts or updates SQLite directly.
- The physical API needed about 14.9 seconds for a 10-event batch, too close to the existing 15-second transport boundary. The production coordinator now sends five ordered events per request while retaining the same bounded timeout and single-flight behavior.
- A successful same-identity replay can promote a stale sequence receipt from `CONFLICT` to `APPLIED`; `APPLIED` remains terminal. The migration repairs only rows already proven by both a synced offline event and a completed checkout result.
- POS v2 downstream RPCs now retain the request bearer identity and device headers after in-place reauthentication.

## Physical A30 evidence

Device: Xiaomi 21121210G, Android API 34, arm64-v8a, serial `82eaaf10`, package `com.tindio.pos`.

The terminal used organization `baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9`, store `8de6a6de-b006-403e-84eb-c1ac9b36e1c0`, register `5c697afa-720a-4a63-8302-aca541fd23c9`, and product `bc938c56-67ef-4c7a-8238-c805fdddc83f`. The approved synthetic stock adjustment was +1,200; no second adjustment was issued.

| Campaign | Offline evidence | Canonical result |
|---|---|---|
| 100 operations | Sequences 7–106; first event `e7125a93-0b33-4afb-a466-d46556ebcd29`; last event `5f23766e-08cc-4a00-8575-f345774fd5dc`; local queue finished `0/0/0/0`. | 100 unique keys, 100 `SYNCED`, 100 `APPLIED`, 100 sales/payments/receipts/items/movements, total 10,000 minor, inventory delta -100, stock 1,103, checkpoint 106. |
| 1,000 operations | Created in 119,627 ms; sequences 107–1106; first event/key `5a322d9a-8019-4736-ada2-b7c8290f5a1b` / `3f24bf5d-a066-4f32-93ad-a6cd6674690a`; last event/key `cb71ceba-f1f5-416f-9d39-e65bd4fe8ee2` / `2a7e013a-948f-4352-a86e-d3bac87a869a`; local queue finished `0/0/0/0`. | 1,000 unique keys, 1,000 `SYNCED`, 1,000 `APPLIED`, 1,000 sales/payments/receipts/items/movements, total 100,000 minor, inventory delta -1,000, stock 103, checkpoint 1106. |

The 100-operation campaign reproduced safe ambiguous delivery: the server completed a batch while the client timed out, so the device retained the original pending identities. Replays converged without duplicate financial effect. During the 1,000-operation campaign, five-event pushes generally completed in about 9.4–11.4 seconds; one completed in 13.7 seconds. Recovery stayed serialized through the MOB-03 coordinator, checkout remained restricted while `RECOVERING`, and the queue advanced in exact ordered groups until empty.

## Compatibility, security, and custody

- Database: forward migration `0017_mobile_sequence_conflict_replay.sql`; installed on canonical Neon. No sale, payment, receipt, or inventory schema was replaced.
- SQLite: no schema change and no reset. Outbox events, checkout intents, provisional receipts, recovery records, sequence state, credentials, and sync cursors were preserved across in-place APK installs.
- API: no route or response-schema break. Bearer propagation is corrected for downstream POS RPCs; cookie/server callers retain their existing fallback.
- Tenant/store security: reauthentication validates the current organization before restoring online readiness. Existing organization, employee, device, store, and register checks remain authoritative.
- Payments: the campaign used synthetic cash only. Offline electronic/card payments remain disabled.

## Validation

- A30 behavioral suite: 4/4 passed.
- MOB-03 coordinator: 5/5 passed.
- MOB-04 recovery: 5/5 passed.
- Sequence replay migration: 4/4 passed.
- Request-bearer context: 3/3 passed.
- Phase 12 delta reconciliation: passed.
- Phase 18 disaster model and production contract: 12/12 passed.
- Phase 22 performance/cost: 3/3 passed.
- Root and mobile typecheck: passed.
- Root/mobile lint: passed with three existing warnings and zero errors.
- Android export: passed.
- Static certification: 147/148 automated commands passed; only `test:phase-04-docker-source-connectivity` was unavailable because the local Supabase source was not running. All A30 and affected mobile/recovery checks passed.
- Physical APK: `C:\tmp\TINDIOPOS-MOB10-A30-queue-scale.apk`, SHA-256 `61CBEBB751FBDCB888336F6CBE425D9B22F582118FCDE3906D3137E3AF5213D7`.
- `git diff --check`: passed.

## Remaining limitations

A30 does not certify A48, production signing, Google Play delivery, peripherals, every remaining MOB-10 physical scenario, or merchant-pilot readiness. A48 remains `NOT_RUN`.
