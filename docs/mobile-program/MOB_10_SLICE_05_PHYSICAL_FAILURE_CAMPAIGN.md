# MOB-10 Slice 5 — physical transaction failure campaign

Status: **A14, A21, AND A26 PASS; MOB-10 REMAINS OPEN**

Starting commit: `ce8718ff999b3cabc24e46e8f22233419cd0db77`

This evidence records a physical Android execution of A14: the server committed a synthetic online cash checkout, the successful response was deliberately withheld outside the application, and the app process was killed before it could acknowledge the result. A cold restart recovered the original durable checkout identity and replayed the original payload through the production checkout path. The authoritative database retained one financial and inventory effect.

No production fault hook, SQLite edit, database mutation outside the checkout API, app-data clear, uninstall, identity replacement, or custody deletion was used.

## Acceptance result

| Case | Result | Physical/runtime evidence |
|---|---|---|
| A14 | `PASS` | The first real `/api/pos/v2/checkout` request committed receipt 36 and sale `41e4e582-8422-4561-b406-ddb47788459f`. A temporary one-shot network relay received the complete HTTP 200 upstream response and withheld it from the phone. The app was force-stopped 113 ms after that marker. Cold restart recovered idempotency key `2e25ed10-7c01-4976-94a8-fa3af0643ae7`, displayed `UNRESOLVED ONLINE CHECKOUT`, blocked offline fallback, and offered `RETRY ORIGINAL ONLINE CHECKOUT`. One retry returned `SERVER RECEIPT #36`. Neon remained at one request, one sale, one payment, one receipt, one sale item, and one inventory movement. |
| A17 | `PASS` | Previously executed physical process-death case; its evidence uses local reference `OFF-B7F4894C09`, idempotency key `b7f4894c-0933-4534-a3d8-b62b8c47b876`, device sequence 2, and official receipt 34. Consolidation into the final campaign report remains. |
| A21 | `PASS` | Physical Android event `74aef69b-7f91-4698-a999-9b6867c38aba`, idempotency key `6cf34af2-3023-4106-bd6d-ac7e6478ef6c`, provisional receipt `OFF-6CF34AF230`, and device sequence 4 were delivered twice through an external one-shot relay. The first unchanged request returned `ACCEPTED`; the second returned `REPLAY`, both mapping to sale `a1d11324-39b5-4292-b249-471aafe9ad9a` and receipt 37. The relay then returned a deliberately duplicated two-entry ACK array. The app rejected that envelope atomically, restored the original event to `LOCAL_PENDING`, and displayed the incomplete/mismatched-ack custody message. Normal recovery replayed the same identity, drained the outbox, advanced the checkpoint to 4, and left exactly one sale/payment/receipt/item/inventory movement. |
| A25 | `PASS` | Previously executed physical concurrent-trigger case; its evidence uses local reference `OFF-AE7354477B`, idempotency key `ae735447-7b41-4c80-9546-81b6bc7a02a6`, device sequence 3, and official receipt 35. Consolidation into the final campaign report remains. |
| A26 | `PASS` | Physical Android event `c54c80f6-4f0f-490e-915e-8ff515fbacc7`, idempotency key `049eaaaa-a52a-4b1b-9bd9-86bedac0bf7c`, provisional receipt `OFF-049EAAAAA5`, and sequence 5 were captured by an external relay after the production coordinator claimed the event. The relay held the request without forwarding it; the app was force-stopped 139 ms after relay receipt and the client connection closed. Neon still had zero matching effects. Cold restart emitted the same identity again, proving immediate reclamation from interrupted `SYNCING`; a temporary 503 kept it `LOCAL_PENDING` for inspection. Normal recovery then created exactly one sale/payment/receipt/item/inventory movement, mapped the immutable snapshot to receipt 38, advanced checkpoint 4 to 5, and cleared the outbox. |
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

## A21 duplicate-delivery and duplicate-ACK evidence

A21 began from commit `6927122185b17bf585cdfbbfa9f9cab4815c32ae`. The unchanged application accepted one synthetic PHP 1.00 offline cash sale while the backend was unavailable. Before delivery, the physical device reported one `LOCAL_PENDING` event, next local sequence 5, local server checkpoint 3, and next expected server sequence 4. A read-only Neon assertion found no matching checkout request or financial effect and stock remained 6.

The temporary relay captured the production sync envelope without logging credentials and forwarded its exact bytes twice to the unchanged `/api/pos/v2/sync/push` route:

| Field | Value |
|---|---|
| Event ID | `74aef69b-7f91-4698-a999-9b6867c38aba` |
| Idempotency key | `6cf34af2-3023-4106-bd6d-ac7e6478ef6c` |
| Provisional receipt | `OFF-6CF34AF230` |
| Device sequence | 4 |
| Amount | PHP 1.00 / 100 minor units |
| First delivery | `SYNCED`, sync status `ACCEPTED`, checkpoint 4 |
| Duplicate delivery | `SYNCED`, sync status `REPLAY`, checkpoint 4 |
| Authoritative sale | `a1d11324-39b5-4292-b249-471aafe9ad9a` |
| Authoritative receipt | 37 |
| Checkout payload hash | `69362f4abd9f050d92bc3ea774bcad87` |

After those two deliveries, the relay returned two copies of the same ACK in one response. The mobile validator rejected the complete response before applying terminal state. The physical Sync Status screen then showed:

- outbox `1 / 0 / 0 / 0`;
- `OFF-6CF34AF230 — sequence 4 — LOCAL_PENDING`;
- `TINDIO returned an incomplete or mismatched acknowledgement. This saved sale remains queued with its original identity.`;
- next local sequence 5 and local known server checkpoint 4.

The laptop Wi-Fi disconnected during final recovery while the APK still targeted `192.168.1.8`. The resulting sign-in message was transport-related: the phone could not reach the local POS backend. Reconnecting the laptop to its saved S2S Wi-Fi profile restored the same endpoint. In-place reauthentication then used the existing employee, device, store, register, and transaction custody. No app data, cache, grant, SQLite row, or transaction identity was reset or replaced.

The normal recovery request returned a valid replay acknowledgement for the original identity. Final physical state was `READY OFFLINE`, `CLOUD_ONLINE`, online authenticated, outbox `0 / 0 / 0 / 0`, no oldest unresolved event, checkpoint 4, next sequence 5, contiguous sequence health, and no last sync error. A final read-only Neon query remained at one checkout request, one sale, one PHP 1.00 payment, one receipt 37, one item, and one inventory movement of -1; stock remained 5. Duplicate delivery and the duplicate ACK therefore produced no duplicate financial or inventory effect and did not regress local state.

The relay was external test infrastructure only. Production source, the POS v2 API contract, SQLite, and Neon schema were unchanged. Its port owner and the temporary Next.js port owner were stopped after evidence capture; ports 3000 and 3001 were no longer listening.

## A26 kill-during-SYNCING evidence

A26 began from commit `9510f58ac4f9a447642f2ed71daba3558f0d6361`. With the backend unavailable, the unchanged application accepted one synthetic PHP 1.00 cash sale. Before interruption, the physical Sync Status screen showed `OFF-049EAAAAA5` as `LOCAL_PENDING`, outbox `1 / 0 / 0 / 0`, next local sequence 6, local server checkpoint 4, and next expected sequence 5. A read-only Neon assertion found zero matching requests or financial effects and authoritative stock remained 5.

The temporary relay fully buffered the first production `/api/pos/v2/sync/push` request and deliberately did not forward it. Receipt of that request proves the production coordinator had already atomically claimed the event as `SYNCING`. The relay captured:

| Field | Value |
|---|---|
| Event ID | `c54c80f6-4f0f-490e-915e-8ff515fbacc7` |
| Idempotency/checkout identity | `049eaaaa-a52a-4b1b-9bd9-86bedac0bf7c` |
| Provisional receipt | `OFF-049EAAAAA5` |
| Device sequence | 5 |
| Amount | PHP 1.00 / 100 minor units |
| Item snapshot | 1 each, Phase 04F Certification Item at PHP 1.00 |
| Initial request received | `2026-10-11T16:47:01.603Z` |
| Process force-stop | `2026-10-11T16:47:01.742Z` |
| First request forwarded | No |
| Database state after kill | zero request/sale/payment/receipt/item/movement rows; stock 5 |

On cold restart at `2026-10-11T16:47:19.503Z`, the normal recovery coordinator emitted a second request at `2026-10-11T16:47:21.615Z`. It contained the exact same event ID, idempotency key, local receipt, sequence, and item count. The relay returned a temporary 503 without forwarding this observation request so local custody could be inspected. The terminal reported `RECOVERING`; Sync Status showed the original event as `LOCAL_PENDING`, outbox `1 / 0 / 0 / 0`, amount 100 PHP, next sequence 6, checkpoint 4, and contiguous sequence health. The event was therefore reclaimed rather than stranded, discarded, or replaced.

After enabling normal relay forwarding, the next recovery request again used the same identity. Final evidence was:

- terminal `READY OFFLINE` and `CLOUD_ONLINE`;
- outbox `0 / 0 / 0 / 0`, no oldest unresolved event;
- local checkpoint 5, next sequence 6, next expected sequence 6, `CONTIGUOUS`;
- saved-device receipt `OFF-049EAAAAA5` mapped to `OFFICIAL RECEIPT #38` with the original item, subtotal, total, cash tender, and zero change;
- one completed checkout request, one sale `48e0e111-640f-4f11-913c-6f1ad478e97e`, one PHP 1.00 payment, one receipt 38, one sale item, and one inventory movement of -1;
- authoritative stock moved exactly once from 5 to 4.

This is both delivery/recovery correctness and financial settlement success. No production fault hook, SQLite edit, app-data clear, uninstall, cache reset, identity replacement, custody deletion, or manual merchant-data mutation was used. The relay was external test infrastructure and did not log credentials.

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

Additional A21 checks from starting commit `6927122185b17bf585cdfbbfa9f9cab4815c32ae`:

- Mobile outbox coordinator: 5/5 passed, including full-envelope validation before terminal state.
- Mobile outbox recovery: 5/5 passed.
- Phase 10/11/12 checks: 3/3 passed.
- Phase 18 disaster model: 11/11 passed.
- Phase 18 production contract: 1/1 passed.
- Mobile source of truth: 4/4 passed.
- Mobile and root typecheck: passed.
- Mobile/root lint: 0 errors; 1/3 pre-existing warnings respectively.
- Android export: passed, 1,440 modules bundled.
- Static certification: 143/144 automated package commands passed; the unrelated `test:phase-04-docker-source-connectivity` check reported `Local Supabase source is unavailable`. No production or historical database was changed to satisfy that local-environment prerequisite.
- `git diff --check`: passed before evidence changes.

Additional A26 checks from starting commit `9510f58ac4f9a447642f2ed71daba3558f0d6361`:

- Mobile outbox coordinator: 5/5 passed.
- Mobile outbox recovery: 5/5 passed.
- Phase 10/11/12 checks: 3/3 passed.
- Phase 18 disaster model: 11/11 passed, including interrupted `SYNCING` reclamation.
- Phase 18 production contract: 1/1 passed.
- Mobile source of truth: 4/4 passed.
- Mobile and root typecheck: passed.
- Lint: passed with 0 errors and 3 pre-existing warnings.
- Android export: passed, 1,440 modules bundled.
- Static certification: 143/144 automated package commands passed; only the unrelated `test:phase-04-docker-source-connectivity` local-environment prerequisite failed with `Local Supabase source is unavailable`.
- `git diff --check`: passed before evidence commit.

## Remaining limitations and next slice

A14, A21, and A26 prove response-loss recovery, duplicate-delivery/duplicate-ACK correctness, and process-death reclamation during `SYNCING` for their synthetic transactions. They do not certify A27, A48, signed-AAB delivery, 16 KB-page physical hardware, peripherals, upgrades beyond A42, or merchant pilot readiness.

Next smallest safe slice: A27 timeout / 429 / 503 / malformed-ACK physical execution with bounded retry, stable identities, and no false terminal success. A48 remains `NOT_RUN` until the real Phase 23/24 production release candidate exists.
