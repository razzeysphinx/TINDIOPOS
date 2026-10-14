# MOB-10 Slice 17 — A40 secure Store Hub transport

Status: **A40 BLOCKED; implementation hardening complete, physical release proof not run**

Starting commit: `3c02a638353742272a7246572d73bc4af3366f54`

## Observed defect

Android production builds correctly disabled global cleartext traffic, but the Store Hub created only an HTTP server and mobile configuration accepted HTTP endpoints. Direct release-build Hub use therefore had no deployable production transport contract.

## Gap matrix and architecture decision

| Classification | Decision |
|---|---|
| KEEP | Existing Store Hub protocol, append-only journal, store-scoped token, organization/store validation, minimized peer metadata, and Hub/cloud ACK separation |
| KEEP + HARDEN | Android global cleartext denial, SecureStore configuration, bounded client requests, and private-network endpoint restriction |
| EXTEND | Serve HTTPS directly from certificate/key files with TLS 1.2 minimum and HSTS responses |
| REFACTOR | Move release/development protocol acceptance into a small testable transport policy |
| REPLACE | HTTP-by-default Hub startup with TLS-by-default fail-closed startup |
| REMOVE | Unconditional release acceptance of `http://` Hub endpoints |
| NEW | Explicit non-production HTTP override, deployment/trust runbook, and A40 behavioral suite |

Production now requires certificate and private-key paths. The two must be configured together. Plain HTTP requires `TINDIO_STORE_HUB_ALLOW_INSECURE_HTTP=1` and is still rejected when `NODE_ENV=production`.

Mobile release runtime accepts only HTTPS. `__DEV__` retains HTTP for explicit development builds, while `app.config.js` continues to enable Android cleartext only for the development EAS profile. An old HTTP SecureStore configuration becomes unavailable to release runtime but is not deleted.

## Changed files

- `apps/store-hub/src/server.mjs`
- `apps/store-hub/README.md`
- `apps/mobile/src/features/store-hub/store-hub-config.ts`
- `apps/mobile/src/features/store-hub/store-hub-transport-policy.ts`
- `apps/mobile/app/(app)/settings.tsx`
- `scripts/mobile-a39-store-hub-resilience.test.mjs`
- `scripts/mobile-a40-store-hub-transport.test.mjs`
- `docs/mobile-program/PHASE_15_STORE_LOCAL_MODE_STORE_HUB.md`
- `package.json`
- this evidence document

## Compatibility and custody impact

- Server database/Neon: no schema or data change.
- SQLite: no schema or row change.
- Store Hub API: routes, payloads, scopes, token authentication, revisions, and acknowledgement semantics are unchanged; only the production transport changes from HTTP to HTTPS.
- Mobile API/POS v2: unchanged.
- Tenant/store security: existing organization/store validation remains; TLS now protects the store-scoped token and minimized event metadata in transit.
- Transaction custody: outbox events, checkout intents, receipts, recovery rows, device sequences, synchronization cursors, credentials, and unresolved sales are not deleted or rewritten.
- Existing development HTTP tests use the explicit non-production override.

## Tests and exact results

- A40 transport behavioral suite: **3/3 passed**.
  - release policy accepts HTTPS and rejects HTTP;
  - Hub fails closed without complete TLS configuration, including when a production process requests the HTTP override;
  - native TLS setup retains Android global cleartext denial.
- A39 resilience regression: **3/3 passed**.
- Phase 15 Store Local Mode check: **1/1 passed**.
- Phase 23 Android hardening checks: **6/6 passed**.
- Mobile typecheck: **passed**.
- Root typecheck: **passed**.
- Lint: **passed with 0 errors and 3 pre-existing warnings**.
- Production-profile Android export: **passed**, Hermes bundle with 1,446 modules.
- Static repository certification: **152/153 automated package commands passed**. The sole failure was `test:phase-04-docker-source-connectivity` because the local Supabase source was unavailable; it is unrelated to this transport change.
- `git diff --check`: **passed**.

## Physical/release evidence and acceptance result

| Acceptance ID | Result | Reason |
|---|---|---|
| A40 | **BLOCKED** | Source/runtime policy and production-profile Android export pass, but no merchant-grade hostname, trusted certificate chain, directly reachable private-network Hub, or actual Phase 23/24 release-signed build was available. Therefore a release build has not yet connected to the intended trusted Hub transport. |

The missing proof must use a certificate valid for the exact configured private-network hostname or IP and trusted by the Android device. The test must inspect the release manifest, connect without any global cleartext exception, verify wrong/untrusted certificates fail, and repeat the Hub/cloud ACK separation check. A development HTTP tunnel or disabled certificate validation is not acceptable evidence.

A38 and the true LAN portions of A39 remain blocked by unavailable hardware/network conditions. A41 is not applicable while electronic/offline PSP support remains disabled. A42 is already PASS. A48 remains **NOT_RUN** until the actual production release candidate exists.

## Next smallest safe slice

Proceed to A43: verify an older supported mobile client against the upgraded backend and prove either contract compatibility or a safe upgrade response that preserves recovery. Resume A40 when the trusted Hub certificate, private-network hostname, and release candidate are available.
