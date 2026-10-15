# MOB-10 Slice 20 — A45 operational alert routing

Status: **A45 PASS — physical native crash, Android ANR, sanitized routing, and custody preservation verified**

Starting commit: `ed985b15c8662ded9b61b1b91ca5729abbfa3478`

## Observed defect

Phase 26 collected aggregate terminal telemetry, but the product had no durable routed alert, no named operator or escalation channel, no alert acknowledgement, no ANR/responsiveness signal, and no behavioral injection proving API-outage or stale-queue recovery. The existing root boundary reports React/application errors; it is not evidence of native Android process crashes.

## Architecture decision

**KEEP + HARDEN / EXTEND.** Preserve the Phase 17 telemetry reporter and RPC, Phase 23 application-error boundary, Phase 25 device registry, provider-neutral identity, Neon authority, and all MOB-08 custody/finalization controls. Alert evaluation now occurs atomically inside the existing telemetry RPC, so there is no second telemetry or synchronization engine.

Four durable alert classes are evaluated: `APP_CRASH`, `ANR`, `API_OUTAGE`, and `STALE_QUEUE`. The server assigns each alert to an active named employee with `devices.manage`, routes it to `Back Office > Production Observability`, and constructs diagnostics from fixed aggregate fields. The Back Office exposes the matching runbook and a permission-checked acknowledgement action. API-outage and stale-queue alerts resolve when current telemetry proves recovery; historical alerts remain retained.

The mobile shell records active-JavaScript responsiveness stalls through one app-level, AppState-aware watchdog. It does not run while the app is backgrounded, never renews authorization, and never mutates financial or custody state.

Android 11+ builds also reconcile `ApplicationExitInfo` after restart. Only the exit class (`NATIVE_CRASH`, `JAVA_CRASH`, or `ANR`) and timestamp cross the native boundary. Reconciliation occurs before cloud business context is required, so an exit during startup or an expired cloud session is retained locally and uploaded after validated context returns. A monotonic processed timestamp prevents historical exits from being counted again.

The physical injection controls exist only on the hidden authenticated certification route and fail closed unless Android marks the installed package `DEBUGGABLE`. Production builds expose neither enabled controls nor an alternate financial/synchronization path.

## Changed files

- `database/migrations/0019_mobile_a45_operational_alerts.sql`
- `apps/mobile/src/features/observability/production-crash-state.ts`
- `apps/mobile/src/features/observability/production-responsiveness-monitor.tsx`
- `apps/mobile/modules/tindio-exit-observer/`
- `apps/mobile/app/(app)/a45-certification.tsx`
- `apps/mobile/app/(app)/_layout.tsx`
- `apps/mobile/src/features/sync/sync-telemetry-reporter.tsx`
- `apps/mobile/src/lib/tindio-api.ts`
- `src/app/api/pos/v2/sync/telemetry/route.ts`
- `src/features/observability/actions.ts`
- `src/features/observability/production-observability-center.tsx`
- `src/app/(back-office)/back-office/observability/page.tsx`
- `src/lib/supabase/database.types.ts`
- `scripts/mobile-a45-operational-alerts.test.mjs`
- `scripts/apply-mobile-a45-operational-alerts.mjs`
- `scripts/mobile-a45-operational-alerts-live.mjs`
- `scripts/phase-26-production-observability-check.mjs`
- `package.json`
- Phase 26 and this evidence document

## Database, SQLite, API, security, and custody impact

- Canonical Neon migration `0019` is installed on branch `r6-clean-canonical-20261002`; the rehearsal passed inside a rollback transaction before installation.
- `pos_device_sync_telemetry` adds aggregate ANR count/time fields. `pos_operational_alerts` is a tenant-scoped durable alert ledger with RLS enabled and no direct runtime-table grants.
- Alert listing and acknowledgement are RPC-only, require the current organization employee and `devices.manage`, and use explicit `tindio_authenticated` execute grants. Other runtime roles and `PUBLIC` are revoked.
- Existing telemetry callers remain compatible because the expanded fields have defaults. The current API supplies them explicitly.
- SQLite schema impact is **NONE**. Counts and timestamps use existing local metadata storage.
- No sale, payment, receipt, inventory movement, outbox event, checkout identity, device sequence, sync cursor, credential, recovery record, custody lease, or finalization token is deleted or rewritten.
- The alert table never receives transaction/customer/payment payloads, credentials, exception messages, or stack traces.

## Canonical Neon authenticated runtime evidence

Synthetic fixture:

| Field | Value |
|---|---|
| Organization | `baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9` |
| Device | `3b1cc9ff-ff92-4ebd-aac1-1b16975d2527` |
| Assigned operator | `TINDIO Phase 04 Certification User` |
| Escalation channel | `Back Office > Production Observability` |

The authenticated telemetry RPC produced all four alerts. Diagnostics contained only app version, counts, timestamps, connection mode, latency, queue/failure/conflict counts, and checkpoints. The test rejected sensitive-key names including payload, receipt, customer, payment, token, secret, exception, stack, and email.

`APP_CRASH` and `ANR` became `ACKNOWLEDGED`. Recovery telemetry changed `API_OUTAGE` and `STALE_QUEUE` to `RESOLVED`. The synthetic device was then retired as `RECONCILED`.

Financial counts were identical before and after: sales `1113`, payments `1113`, receipts `1113`, and inventory movements `1118`.

## Physical Android crash and ANR evidence

The existing installation on Xiaomi `21121210G`, Android API 34, ARM64, was updated in place with the same signer. `firstInstallTime` remained `2026-10-09 22:13:25`; the application was never uninstalled and app data was never cleared.

Before injection, the app-private SQLite snapshot contained 1,111 outbox events, 1,111 local receipts, one checkout intent, and five recovery records. Android reported zero actionable historical exits.

The debuggable-only native crash control terminated PID `17743`. Android recorded:

```text
timestamp=2026-10-15 14:39:26.069
reason=5 (APP CRASH(NATIVE))
status=11
```

After cold restart, the native history exposed `NATIVE_CRASH · 2026-10-15T06:39:26.069Z`, and local aggregate state became `crashCount=1`, `anrCount=0`.

The debuggable-only ANR control then blocked the main looper. A real input event crossed Android's five-second dispatch deadline. Android recorded:

```text
timestamp=2026-10-15 14:41:43.942
reason=6 (ANR)
description=Input dispatching timed out ... Waited 5000ms for MotionEvent(action=DOWN)
```

After the next cold restart, the diagnostic view showed both original timestamps and local aggregate state became exactly `crashCount=1`, `anrCount=1`. A further cold restart retained those counts, proving exit-history deduplication.

Custody hashes were identical before the crash, after the crash, after the ANR, and after the deduplication restart:

| Protected state | Rows | SHA-256 |
|---|---:|---|
| Outbox identities, sequences, payloads, snapshots, and states | 1,111 | `e6da7484a487526104726d1712f15307263af116792ddc0365cc1f08f647d4a3` |
| Immutable local receipts | 1,111 | `263bbc45f2cb2b9e2147e50df570b1baeaf491068bf8e7b55e7a3f0e0c1d3f94` |
| Checkout intents | 1 | `785e272d175715f0cd3e6dcc33f4c6b56ebc8bf209baa102d45e11e3ba4ba60d` |
| Recovery actions | 5 | `b0197134d172bca89db19b9e274fa4e9fae319b94a043da560cef2013dd165c8` |

The exact enrolled physical device `72c8267d-1aaf-4bc0-91f9-86d6eea47797` then reported the two OS-verified aggregate signals to canonical Neon. `APP_CRASH` and `ANR` each opened once for `TINDIO Phase 04 Certification User` in `Back Office > Production Observability`. Their diagnostics contained only app version, count, and the matching physical timestamp. Replaying the same aggregate report produced no new occurrence. Financial counts remained sales `1113`, payments `1113`, receipts `1113`, and inventory movements `1118`.

## Regression results

- A45 behavioral suite: **6/6 passed**.
- Phase 26 observability: **6/6 passed**.
- Phase 16 isolated-device contract: **1/1 passed**.
- Phase 17 sync-control contract: **1/1 passed**.
- Phase 18 disaster model: **11/11 passed**.
- Phase 18 production contract: **1/1 passed**.
- Canonical Neon migration rehearsal: **passed and rolled back**.
- Canonical Neon migration installation: **passed**; protected row counts unchanged.
- Canonical Neon authenticated live fixture: **implementation runtime passed**.
- Root typecheck: **passed**.
- Mobile typecheck: **passed**.
- Lint: **passed with 0 errors and 1 pre-existing warning** (`_info` in the production error boundary).
- Android export: **passed**, Hermes bundle with 1,449 modules.
- Native Android compilation: the local exit-observer module compiled in both debug and release library variants during the physical-test build. A subsequent full `assembleRelease` verification remained CPU-active but exceeded the ten-minute command ceiling and produced no APK; it is recorded as **TIMED OUT**, not passed. This is not A48 evidence.
- Static repository certification: **155/156 automated package commands passed**. The sole failure was `test:phase-04-docker-source-connectivity` because the local Supabase source was unavailable; it is unrelated to A45.
- `git diff --check`: **passed**.

## Acceptance result and limitations

| Acceptance ID | Result | Evidence |
|---|---|---|
| A45 — API outage | **PASS** | Authenticated canonical-Neon injection created a named, sanitized alert and current recovered telemetry resolved it. |
| A45 — stale queue | **PASS** | Authenticated canonical-Neon injection created a named, sanitized alert and zero-queue/current-checkpoint telemetry resolved it. |
| A45 — application crash routing | **PASS** | Android classified the physical injected failure as native crash reason 5/status 11; restart retained it exactly once and canonical Neon routed one sanitized named-operator alert. |
| A45 — ANR routing | **PASS** | Android classified the physical main-thread/input-dispatch failure as ANR reason 6 after 5,000 ms; restart retained it exactly once and canonical Neon routed one sanitized named-operator alert. |

A45 is complete. The phone was restored in place to the saved same-signer non-debug APK after injection; its original install time remained unchanged and Android denied debug `run-as` access. This does not certify a production-signed AAB, Google Play delivery, 16 KB-page release hardware, unavailable HID/printer/second-terminal cases, or merchant-pilot readiness. A48 remains **NOT_RUN**.

## Next smallest safe slice

Proceed to A46, the Play-reviewer credential and restricted-feature-access evidence slice. Keep A48 separate until the real Phase 23/24 production release candidate exists.
