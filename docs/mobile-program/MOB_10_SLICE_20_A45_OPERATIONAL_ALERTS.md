# MOB-10 Slice 20 — A45 operational alert routing

Status: **A45 PARTIAL — physical native crash/ANR evidence remains NOT_RUN**

Starting commit: `ed985b15c8662ded9b61b1b91ca5729abbfa3478`

## Observed defect

Phase 26 collected aggregate terminal telemetry, but the product had no durable routed alert, no named operator or escalation channel, no alert acknowledgement, no ANR/responsiveness signal, and no behavioral injection proving API-outage or stale-queue recovery. The existing root boundary reports React/application errors; it is not evidence of native Android process crashes.

## Architecture decision

**KEEP + HARDEN / EXTEND.** Preserve the Phase 17 telemetry reporter and RPC, Phase 23 application-error boundary, Phase 25 device registry, provider-neutral identity, Neon authority, and all MOB-08 custody/finalization controls. Alert evaluation now occurs atomically inside the existing telemetry RPC, so there is no second telemetry or synchronization engine.

Four durable alert classes are evaluated: `APP_CRASH`, `ANR`, `API_OUTAGE`, and `STALE_QUEUE`. The server assigns each alert to an active named employee with `devices.manage`, routes it to `Back Office > Production Observability`, and constructs diagnostics from fixed aggregate fields. The Back Office exposes the matching runbook and a permission-checked acknowledgement action. API-outage and stale-queue alerts resolve when current telemetry proves recovery; historical alerts remain retained.

The mobile shell records active-JavaScript responsiveness stalls through one app-level, AppState-aware watchdog. It does not run while the app is backgrounded, never renews authorization, and never mutates financial or custody state.

## Changed files

- `database/migrations/0019_mobile_a45_operational_alerts.sql`
- `apps/mobile/src/features/observability/production-crash-state.ts`
- `apps/mobile/src/features/observability/production-responsiveness-monitor.tsx`
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

## Regression results

- A45 behavioral suite: **4/4 passed**.
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
- Lint: **passed with 0 errors and 3 pre-existing warnings**.
- Production-profile Android export: **passed**, Hermes bundle with 1,447 modules.
- Static repository certification: **155/156 automated package commands passed**. The sole failure was `test:phase-04-docker-source-connectivity` because the local Supabase source was unavailable; it is unrelated to A45.
- `git diff --check`: **passed**.

## Acceptance result and limitations

| Acceptance ID | Result | Evidence |
|---|---|---|
| A45 — API outage | **PASS** | Authenticated canonical-Neon injection created a named, sanitized alert and current recovered telemetry resolved it. |
| A45 — stale queue | **PASS** | Authenticated canonical-Neon injection created a named, sanitized alert and zero-queue/current-checkpoint telemetry resolved it. |
| A45 — application crash routing | **IMPLEMENTATION PASS / PHYSICAL NOT_RUN** | Aggregate application-crash signal, durable routing, runbook, and acknowledgement are proven; physical native-process crash is not. |
| A45 — ANR routing | **IMPLEMENTATION PASS / PHYSICAL NOT_RUN** | Active-JavaScript stall reporting, durable routing, runbook, and acknowledgement are proven; an operating-system Android ANR is not. |

A45 is therefore not yet fully certified. A physical Android build must inject a true native process crash and a true Android ANR, then prove that sanitized diagnostics reach the named operator. A48 remains **NOT_RUN**.

## Next smallest safe slice

Install an updated development artifact on the existing physical Android device and run only the remaining A45 native-crash and Android-ANR injections. Do not clear app data or begin A48.
