# MOB-10 Slice 16 — A39 Store Hub failure campaign

Status: **A39 BLOCKED; executable implementation and physical subsets passed**

Starting commit: `b909ab16cbd6396a344e5f4836812ae560384bcf`

## Observed defect

The physical device retained Store Hub cursor `1000` after the validated replacement Hub started at revision `0`. The existing synchronization path used `MAX(existing_cursor, new_cursor)` and retained publish signatures from the earlier Hub. It could therefore skip new Hub events and skip republishing retained local events indefinitely.

The defect affected Hub-replica awareness only. It did not alter the authoritative cloud outbox, receipts, checkout intents, payments, inventory ledger, or recovery records.

## Architecture decision

**KEEP + HARDEN.** Preserve the existing HTTP Store Hub, append-only journal, SecureStore configuration, tenant/store validation, SQLite peer-awareness cache, durable outbox, and server-authoritative cloud reconciliation.

When a scope-validated Hub endpoint changes or its current revision is behind the saved cursor, mobile now atomically clears only the Hub replica tables for that organization/store/device:

- `store_hub_events`
- `store_hub_publish_state`
- `store_hub_state`

It then republishes retained outbox metadata and pulls the replacement Hub from cursor zero. It never deletes or rewrites `outbox_events`, receipt summaries, checkout intents, recovery records, device sequences, credentials, or cloud synchronization cursors.

No second checkout, inventory, receipt, or synchronization engine was introduced.

## Changed files

- `apps/mobile/src/features/store-hub/store-hub-replica-policy.ts`
- `apps/mobile/src/features/store-hub/store-hub-sync.ts`
- `apps/mobile/src/db/store-hub-cache.ts`
- `scripts/mobile-a39-store-hub-resilience.test.mjs`
- `package.json`
- this evidence document and the A38 blocker record

## Compatibility and security

- Server database: no migration or data mutation for the fix.
- SQLite schema: unchanged at 13/13.
- API/Hub protocol: no request or response contract change.
- Tenant/store security: existing health-response and per-event scope validation retained.
- Hub tokens: remained in SecureStore and were removed after the campaign.
- Cloud authority: Hub ACK still cannot set an outbox event to `SYNCED`.
- Inventory: Hub activity remains estimate-only; Neon inventory remains authoritative.

## Automated behavioral evidence

The A39 suite starts the real Store Hub as a subprocess and verifies:

- wrong token returns `STORE_HUB_UNAUTHORIZED`;
- wrong store returns `STORE_HUB_SCOPE_MISMATCH`;
- first event produces revision 1;
- duplicate delivery replays revision 1;
- process restart with the same journal recovers revision 1 and the original event;
- cloud-state update produces revision 2;
- duplicate cloud-state ACK remains revision 2;
- no customer, payment, or receipt data enters the journal;
- Hub ACK code cannot mutate cloud-outbox authority;
- endpoint change and cursor-ahead conditions reset only Hub replica state.

## Physical Android evidence

Device: Xiaomi 21121210G, Android API 34, arm64-v8a, serial `82eaaf10`, package `com.tindio.pos`.

The campaign used a same-signer development-cleartext certification APK over a temporary ADB reverse tunnel because Windows administrator policy prevented opening private-LAN TCP 8787. Certification APK SHA-256: `0030487359C3DA24C413AE3F14DBD789A999B079F964DCEE62BE36E30ABDBBF5`.

After the campaign, TINDIO removed the synthetic Hub configuration and installed a same-signer cleartext-disabled APK containing the A39 fix. Final APK SHA-256: `07FFDEE4E93A0CB1F848877C74E828A7AAA0A1CF6D917BD5FB5A0C75614281DC`. The package retained `firstInstallTime=2026-10-09 22:13:25`; no uninstall or app-data clearing occurred.

| Scenario | Executed result |
|---|---|
| Cloud API unavailable, Hub reachable | `STORE_LOCAL` with Hub revision/cursor 1110 |
| Reproduced stale Hub replica | Device cursor 1000 against replacement Hub revision 0 |
| Installed repair | Hub-only state rebuilt; retained events republished; live cursor advanced to 1110 |
| Synthetic offline sale | `OFF-6518297967`, PHP 1.00, device sequence 1111, local state `LOCAL_PENDING` |
| Hub ACK | Hub revision 1111; local outbox remained pending `1 / 0 / 0 / 0` |
| Local Hub identity | Event `c4e3b1b9-787c-4539-ba9e-b924e9683ed1`, device `72c8267d-1aaf-4bc0-91f9-86d6eea47797`, sequence 1111 |
| Hub unavailable | Cold restart entered `DEVICE_ISOLATED`; original unresolved reference remained visible |
| Hub restart | Same journal recovered revision 1111; cold restart returned to `STORE_LOCAL`; revision did not duplicate |
| Wrong token | Physical Settings test returned `STORE_HUB_HTTP_401` |
| Wrong store | Physical Settings test returned `STORE_HUB_SCOPE_MISMATCH` |
| Cloud return | Original local reference reconciled with idempotency key `65182979-6758-4145-acea-94e408e2aa5b` and device sequence 1111 |
| Hub cloud-state update | Same Hub event received `cloudSyncedAt`; revision advanced once to 1112 |
| Duplicate post-cloud Hub sync | Hub revision remained 1112 |
| Final custody | SQLite integrity OK; outbox `0 / 0 / 0 / 0`; oldest unresolved `NONE`; official receipt 1145 remained visible |

## Authoritative cloud result

The repository's read-only canonical Neon assertion returned:

- offline server record state `SYNCED` and sequence state `APPLIED`;
- idempotency key `65182979-6758-4145-acea-94e408e2aa5b`;
- device sequence 1111 and local reference `OFF-6518297967`;
- exactly one checkout request;
- one completed PHP 1.00 sale;
- one PHP 1.00 payment;
- one receipt, official receipt number 1145;
- one sale item totaling PHP 1.00;
- one inventory movement totaling `-1`.

This distinguishes Store Hub delivery/recovery correctness from authoritative financial settlement. Hub revision 1111 did not settle the sale; only the later cloud acknowledgement did.

## Validation

- A39 behavioral suite: **3/3 passed**.
- Affected Phase 15/16/21 checks: **passed**.
- Mobile typecheck: **passed**.
- Root typecheck: **passed**.
- Lint: **passed with 0 errors and 3 pre-existing warnings**.
- Android export: **passed** (Hermes bundle, 1,445 modules).
- Static repository certification: **151/152 automated package commands passed**. The only failure was `test:phase-04-docker-source-connectivity` because the local Supabase source was unavailable; this is an environment/integration gate outside the Store Hub change.
- `git diff --check`: **passed**.
- Same-signer arm64 certification and final release APK builds: **passed**.
- Physical in-place install, mode transitions, scope/auth denial, restart, ACK separation, reconciliation, and custody checks: **passed** for the executed USB-transport subset.

## Acceptance result and limitations

| Acceptance ID | Result | Reason |
|---|---|---|
| A39 | **BLOCKED** | Hub restart, Hub disappearance, auth/scope denial, ACK separation, cloud return, and custody passed. A real Wi-Fi/router WAN outage and physical LAN-link loss remain unevidenced because Windows denied the temporary private-network firewall rule; the successful phone campaign used ADB reverse transport. |

The production application still rejects global cleartext traffic, and the current Store Hub service is HTTP-only. Production-approved Hub transport belongs to A40 and was not implemented or certified in this slice. A48 remains **NOT_RUN**.

## Next smallest safe slice

Proceed to A40: define and implement the production-approved Store Hub transport without enabling global Android cleartext, then prove a release build connects over that transport. A39's true router/Wi-Fi outage evidence must still be completed on a network where the physical phone can reach the Hub directly.
