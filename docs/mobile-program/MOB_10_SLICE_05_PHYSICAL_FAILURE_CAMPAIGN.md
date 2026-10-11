# MOB-10 Slice 5 — physical transaction failure campaign

Status: **A14 PASS; MOB-10 REMAINS OPEN**

Starting commit: `ce8718ff999b3cabc24e46e8f22233419cd0db77`

This evidence records a physical Android execution of A14: the server committed a synthetic online cash checkout, the successful response was deliberately withheld outside the application, and the app process was killed before it could acknowledge the result. A cold restart recovered the original durable checkout identity and replayed the original payload through the production checkout path. The authoritative database retained one financial and inventory effect.

No production fault hook, SQLite edit, database mutation outside the checkout API, app-data clear, uninstall, identity replacement, or custody deletion was used.

## Acceptance result

| Case | Result | Physical/runtime evidence |
|---|---|---|
| A14 | `PASS` | The first real `/api/pos/v2/checkout` request committed receipt 36 and sale `41e4e582-8422-4561-b406-ddb47788459f`. A temporary one-shot network relay received the complete HTTP 200 upstream response and withheld it from the phone. The app was force-stopped 113 ms after that marker. Cold restart recovered idempotency key `2e25ed10-7c01-4976-94a8-fa3af0643ae7`, displayed `UNRESOLVED ONLINE CHECKOUT`, blocked offline fallback, and offered `RETRY ORIGINAL ONLINE CHECKOUT`. One retry returned `SERVER RECEIPT #36`. Neon remained at one request, one sale, one payment, one receipt, one sale item, and one inventory movement. |
| A17 | `PASS` | Previously executed physical process-death case; its evidence uses local reference `OFF-B7F4894C09`, idempotency key `b7f4894c-0933-4534-a3d8-b62b8c47b876`, device sequence 2, and official receipt 34. Consolidation into the final campaign report remains. |
| A21 | `NOT_RUN` | Duplicate delivery/duplicate ACK physical execution remains. |
| A25 | `PASS` | Previously executed physical concurrent-trigger case; its evidence uses local reference `OFF-AE7354477B`, idempotency key `ae735447-7b41-4c80-9546-81b6bc7a02a6`, device sequence 3, and official receipt 35. Consolidation into the final campaign report remains. |
| A26 | `NOT_RUN` | No complete qualifying kill-during-SYNCING result has been certified. |
| A27 | `NOT_RUN` | Timeout, 429, 503, and malformed-ACK physical execution remains. |
| A48 | `NOT_RUN` | This was a debug-key-signed development APK, not the Phase 23/24 production release candidate. |

## Controlled failure method

The physical APK called a temporary LAN relay. The relay forwarded all traffic to the unmodified Next.js server. For the first successful checkout only, it buffered the upstream response and declared the failure point only after receiving HTTP 200 with `ok: true`, `saleId`, and `receiptNumber`. It then withheld that response. This proves the commit boundary without adding a test behavior to production source.

The second checkout request passed through normally. Both requests used the same persisted idempotency key and immutable payload. The temporary relay and development server were stopped after the case; ports 3000 and 3001 were no longer listening.

## Identity and state evidence

| Field | Value |
|---|---|
| Operation/idempotency identity | `2e25ed10-7c01-4976-94a8-fa3af0643ae7` |
| Payload hash observed in Neon | `764f15d58b8a0c496b2f3d0a2bba4154` |
| Amount | PHP 1.00 / 100 minor units |
| Product quantity | 1 |
| Device sequence | Not applicable: A14 exercises the durable online checkout-intent path, not the offline sequenced outbox |
| Provisional receipt | Not applicable: no offline acceptance occurred |
| Authoritative sale | `41e4e582-8422-4561-b406-ddb47788459f` |
| Authoritative receipt | 36 |
| Pre-submit database state | zero matching requests and zero matching effects; stock 7 |
| Interrupted local state | durable intent had been persisted before request and marked submitting; the successful response never reached the app |
| Post-restart local state | same operation key recovered as unresolved; offline fallback blocked; explicit same-identity retry available |
| Final local state | `SERVER RECEIPT #36`; unresolved intent acknowledged; checkout key rotated only after acknowledgement |
| Final database state | one completed request and exactly one sale/payment/receipt/item/inventory movement; stock 6 |

The physical phone remained authenticated, enrolled, assigned to Certification Store, attached to its active shift, and reported `READY OFFLINE` plus `CLOUD_ONLINE` after the final restart. Receipt 36 was visible in server receipt history. There were no TINDIO fatal runtime logs.

## Artifact and device

- Device: Xiaomi `21121210G`, Android 14 / API 34, ARM64-v8a.
- Package: `com.tindio.pos`, versionCode 2.
- Install method: same-signer `adb install -r`; original `firstInstallTime` remained `2026-10-09 22:13:25`.
- Artifact: `C:\tmp\TINDIOPOS-MOB10-A14-lan8.apk` (not committed).
- APK SHA-256: `C485DBDA94E314E6463218E1BB588020D8E1B5B67D2194B56C5F9C1EC6DA5F3E`.
- Debug signer SHA-256: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.

## Architecture and compatibility

- Architecture decision: `KEEP + VERIFY`. No application implementation change was required.
- SQLite: no schema change, direct edit, reset, or cache deletion.
- Neon: no schema change and no manual transaction mutation.
- API: unchanged POS v2 checkout contract; two normal POST requests used the same identity and payload.
- Security: the normal bearer, organization, store, register, employee, device, and active-shift validation path remained in force.
- Transaction custody: the durable online intent survived process death, prevented unrelated offline fallback, and was cleared only after the authoritative replay response.
- Payment policy: synthetic cash only; offline electronic/card payment remained disabled.

## Repository regression results

Physical evidence was executed separately from these source checks:

- Mobile online checkout intent: 5/5 passed.
- Mobile request timeout: 4/4 passed.
- Phase 09 local-first: 1/1 passed.
- Phase 10 durable outbox: 1/1 passed.
- Phase 11 device sequence checkpoints: 1/1 passed.
- Phase 18 disaster model: 11/11 passed.
- Phase 18 production contract: 1/1 passed.
- Mobile typecheck: passed.
- Root typecheck: passed.
- Lint: passed with 0 errors and 3 pre-existing warnings.
- Native ARM64 `assembleRelease`: passed.
- `git diff --check`: passed before evidence commit.

## Remaining limitations and next slice

A14 proves delivery/recovery correctness and successful financial settlement for this synthetic transaction. It does not certify A21, A26, A27, A48, signed-AAB delivery, 16 KB-page physical hardware, peripherals, upgrades beyond A42, or merchant pilot readiness.

Next smallest safe slice: A21 duplicate delivery/duplicate ACK, using the existing operation identity and coordinator while proving that repeated delivery and ACK handling do not increment counts or regress local state.

