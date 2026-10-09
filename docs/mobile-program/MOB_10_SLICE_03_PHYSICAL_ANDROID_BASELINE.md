# MOB-10 Slice 3 — Physical Android offline baseline

Status: **A01, A07, AND A08 PASS; MOB-10 REMAINS OPEN**

Starting commit: `ad701dfa4213a6725bb4eea7847c393ce1bc4764`

This slice qualified a standalone development APK on a physical Android 14 ARM64 phone. It also repaired two blockers encountered by the real device: Android cleartext policy prevented access to the explicitly configured development LAN endpoint, and the deployed canonical Neon database was missing migration 0013 and then exposed an ambiguous PL/pgSQL conflict target. No sale was created, no local database was reset, and no installed application data was cleared.

## Device and artifact

| Field | Evidence |
|---|---|
| Device | Xiaomi `21121210G`; Android 14 / API 34; ARM64-v8a |
| Kernel page size | 4096 bytes |
| Package | `com.tindio.pos` |
| Version | `1.0.0` (`versionCode` 1); min SDK 24; target SDK 36 |
| Artifact | `C:\tmp\TINDIOPOS-MOB10-development-cleartext-lan6.apk` (not committed) |
| SHA-256 | `B7F5540D965F5AD7DC1C6B22B77E82D7B7CC1F3E3CA219B11178EABBC561BAD3` |
| Signer | Generated debug certificate; SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` |
| Native qualification | ARM64-v8a; APK `zipalign -P 16` PASS (preliminary only) |
| Backend | Development LAN endpoint; values and tenant identifiers redacted |

Production, preview, and unspecified builds continue to disable cleartext traffic. This development exception does not satisfy A40 or A48.

## Observed defects and decisions

1. Android target API 36 blocked the development-only HTTP LAN backend. Dynamic Expo configuration now permits cleartext only for the `development` EAS profile and explicitly disables it for preview, production, and unspecified profiles.
2. Canonical Neon had deployment drift: migration 0013 custody objects were absent. The exact committed migration was applied without replaying or resetting the database, followed by a Neon Data API schema-cache refresh.
3. The first real custody acquisition then failed with PostgreSQL `42702` because the function's `shift_id` output variable made `ON CONFLICT (organization_id, shift_id, device_id)` ambiguous. Forward migration 0014 uses the named primary-key constraint. It contains no deletion and was applied to canonical Neon.

The backend remains authoritative. The change does not introduce another checkout, inventory, identity, or payment engine.

## Physical acceptance evidence

| Case | Result | Physical result |
|---|---|---|
| A01 | `PASS` | Clean install showed `PREPARATION REQUIRED`; the cashier signed in, enrolled the phone, obtained its current assignment and shift, prepared the terminal, and reached `READY OFFLINE`. An online force-stop/cold start remained ready with the active shift present. Assignment/device enforcement remains server-authoritative and its affected contracts passed. |
| A07 | `PASS` | With Wi-Fi and mobile data disabled, a force-stop/cold start reported `READY OFFLINE`, `DEVICE_ISOLATED`, a complete one-item SQLite catalog, the offline cash-sale surface, cached-customer search, and local saved-receipt access. Server-only receipt detail/refund/delivery was truthfully marked connectivity-dependent. No errors or fatal logs occurred. |
| A08 | `PASS` | Before preparation, both the fresh installation and a disconnected cold start reported `PREPARATION REQUIRED` and never reported ready. |
| A42 | `NOT_RUN` | No unresolved financial transaction was manufactured in this baseline. A controlled two-binary in-place upgrade is still required. |
| A48 | `NOT_RUN` | The tested artifact is a debug-key-signed APK, not the actual production-signed AAB. |

Additional lifecycle evidence: after restoring connectivity, online cold start returned `READY OFFLINE`; backgrounding into Android Settings and reopening returned `READY OFFLINE` and `CLOUD_ONLINE`, with zero recovering/preparation/error/fatal indicators. The authorization shown by the device was valid until `2026-10-10T03:15:17.756Z` and was renewed by validated cloud recovery during testing. Local timers did not perform renewal.

## Compatibility, security, and custody

- Database: migration 0013 was deployed to repair drift; forward migration 0014 changes only the custody function's conflict-target syntax.
- SQLite: no schema change and no reset; schema remained 12/12 with integrity `OK`.
- API: POS v2 request and response contracts are unchanged.
- Tenant/store: enrollment, current business context, assignment, employee, store, register, and open-shift validation remained required before custody and authorization.
- Custody: the active shift lease and device authorization were preserved. Outbox counts remained zero. No receipt, checkout intent, recovery record, device sequence, cursor, credential, or unresolved transaction was deleted or reset.
- Payments: no electronic/card offline payment was enabled. No sale was created.

## Validation

| Check | Result |
|---|---|
| Shift-custody regression | PASS — 6/6 |
| Canonical installer contract | PASS — 5/5 |
| Phases 06 native/provider-neutral | PASS — 2 suites |
| Phases 08, 10, 16, and 18 | PASS — 4 suites |
| Phase 23 Android hardening | PASS — 6/6 |
| Mobile typecheck | PASS |
| Root typecheck | PASS |
| Lint | PASS — 0 errors, 3 pre-existing warnings |
| Android export | PASS |
| Static certification | BLOCKED — 142/143; only local Supabase source connectivity unavailable |
| `git diff --check` | PASS |

## Commits and next slice

- Development transport policy: `d15f5c71f3bfe723e34c8ba00a98a04df21c6a3e`
- Custody conflict-target repair: `fd8aa9765731d9088a3c4c5e2766f4cf0088b424`

Next smallest safe slice: execute A42 as a controlled in-place binary upgrade with a synthetic unresolved transaction, proving stable identity, payload, device secret, sequence, and exactly-once reconnect behavior. Preserve the current installation and active custody. A48 remains separate and requires the actual production-signed AAB.
