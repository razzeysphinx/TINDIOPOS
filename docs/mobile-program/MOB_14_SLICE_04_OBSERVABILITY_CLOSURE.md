# MOB-14 Slice 04 — Observability closure

## Outcome

MOB-14 implementation is complete. The existing A45 production-observability
architecture already provides four durable alert classes, tenant-scoped named
ownership, an escalation channel, operator runbooks, permission-checked
acknowledgement, recovery resolution, sanitized diagnostics, and physical
Android plus canonical-Neon evidence.

This final slice closes the remaining API cost-metric defect. A response whose
server omitted `Content-Length` was recorded as zero bytes even when it had a
body. A valid declared size is now used directly; otherwise a clone is measured
asynchronously. The original response is returned immediately and remains
unconsumed. Telemetry failure cannot change the API result.

## Starting point and gap matrix

- Branch: `TINDIO-PREPRODUCTION`
- Starting commit: `3a91624c045a4eb17431aa32c32dde35d6b8e29d`

| Decision | Area | Result |
|---|---|---|
| KEEP | A45 alert routing, ownership, escalation, runbooks and acknowledgement | Existing behavioral, physical Android and canonical-Neon evidence remains valid. |
| KEEP + HARDEN | Phase 22 API metrics | Preserve request count, latency, retry and failure semantics while correcting response bytes. |
| EXTEND | Response-size observation | Measure an isolated clone when a trustworthy declared length is unavailable. |
| REFACTOR | Byte normalization | Use one finite, non-negative integer normalization path for declared and measured values. |
| REPLACE | Header-only byte accounting | Missing, malformed, negative and unsafe lengths now use measured fallback instead of permanent zero. |
| REMOVE | None | No alert, transport, API, database or custody behavior is removed. |
| NEW | MOB-14 API telemetry suite | Six behavioral cases cover declared, undeclared, malformed and failed measurement plus retry/count integrity. |

## Changed files

- `apps/mobile/src/features/performance/performance-metrics.ts`
- `apps/mobile/src/lib/tindio-api.ts`
- `scripts/mobile-mob-14-api-telemetry.test.mjs`
- `scripts/mobile-request-timeout.test.mjs`
- `package.json`
- this evidence document

## Database, SQLite, API, security and custody impact

- Database migration: none.
- SQLite migration: none.
- POS v2 request and response contracts: unchanged.
- Supabase Auth, provider-neutral identity and Neon authority: unchanged.
- Tenant/store headers and authorization: unchanged.
- No response payload is logged, persisted or sent through a second telemetry
  pipeline. Only an aggregate byte count is retained in process memory.
- A clone is used only for measurement. Clone or body-read failure is ignored
  and cannot reject, delay or replace the original API response.
- Sales, payments, receipts, inventory, outbox events, checkout identities,
  device sequences, cursors, credentials, recovery records, custody leases and
  finalization guards are untouched.

## Acceptance mapping

- A45 remains **PASS**. Existing evidence proves API-outage, stale-queue,
  application-crash and ANR routing; named ownership; runbook visibility;
  acknowledgement; recovery; diagnostic sanitization; and unchanged financial
  custody.
- Phase 22 response-byte telemetry no longer silently undercounts bodies when
  `Content-Length` is absent or invalid.
- Phase 26 continues to use the existing telemetry pipeline. No second alert or
  synchronization engine was created.
- A48 remains **NOT_RUN**. No production AAB was built or submitted.

## Validation

- `pnpm test:mobile-mob-14-api-telemetry`: PASS, 6/6.
- `pnpm test:mobile-request-timeout`: PASS, 4/4.
- `pnpm test:phase-22-performance`: PASS, 3/3.
- `pnpm test:mobile-a45-operational-alerts`: PASS, 6/6.
- `pnpm test:phase-26-observability`: PASS, 6/6.
- `pnpm test:mobile-mob-14-crash-reconciliation`: PASS, 6/6.
- `pnpm test:phase-23-android-hardening`: PASS, 6/6.
- `pnpm mobile:typecheck`: PASS.
- `pnpm typecheck`: PASS.
- `pnpm lint`: PASS with 0 errors and 3 pre-existing warnings.
- `pnpm mobile:export:android`: PASS, 1,453 modules.
- `pnpm certify:static`: 163/165 automated package commands passed. The
  unchanged environment-dependent `test:phase-14-final-recovery` and
  `test:phase-04-docker-source-connectivity` checks failed because the local
  Supabase source is unavailable.
- `git diff --check`: PASS.

## Remaining limitations

This source implementation closure does not certify a production-signed AAB,
Google Play delivery, physical upgrade of the eventual release candidate,
unavailable printer/HID/second-device cases, or merchant-pilot readiness. Those
deferred evidence items remain tracked separately. Production readiness must
remain fail-closed until the Phase 23/24 release candidate and all required
acceptance evidence exist.
