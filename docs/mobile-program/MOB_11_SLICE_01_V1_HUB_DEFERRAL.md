# MOB-11 Slice 01 — first-release Store Hub deferral

## Phase and ticket

```text
Mobile Phases 15, 19, 21, and 23
MOB-11 Slice 01
Store Hub first-release scope decision
```

## Starting commit

```text
e30bf5824c727e14f81baf8f570383eed7673d73
```

## Observed gap

The Store Hub protocol, durable journal, tenant/store checks, HTTPS transport,
and Hub/cloud acknowledgement separation exist. A39 and A40 nevertheless lack
the required direct LAN/WAN, trusted-certificate, and release-build evidence.
The product still exposed manual Hub configuration and synchronization actions,
which could imply that the uncertified capability belonged to the first
production release.

## Architecture decision

Defer Store Hub from the first release. Preserve the implementation and all
previously stored secure configuration, but fail closed before reading Hub
credentials or making a Hub request. Hide configuration and synchronization
actions and explain that prepared isolated-device offline cash plus
authoritative cloud reconciliation remain supported.

This is a release-scope decision, not Store Hub certification. Phase 15 remains
implemented but deferred/uncertified. A39 and A40 retain their recorded
`BLOCKED` status.

## Gap matrix

| Classification | Decision |
| --- | --- |
| KEEP | Existing Hub server, journal, minimal event protocol, SecureStore configuration, HTTPS-only release policy, tenant/store checks, and cloud-ACK separation |
| KEEP + HARDEN | Central mobile release-scope guard blocks credential reads, requests, configuration writes, and configuration removal |
| EXTEND | Cashier-facing explanation of the supported isolated-device scope |
| REFACTOR | None |
| REPLACE | None |
| REMOVE | Store Hub controls from the first-release runtime UI, without deleting their implementation or stored configuration |
| NEW | MOB-11 behavioral/source-contract suite and this decision record |

## Changed files

- central Store Hub release-scope policy;
- Store Hub configuration and client fail-closed guards;
- Settings and Sync Status release-scope messaging;
- MOB-11 behavioral/source-contract tests;
- Phase 15 and Store Hub operational documentation;
- package test command and this evidence report.

## Database, SQLite, and API compatibility

```text
Neon migration: NONE
SQLite migration/reset: NONE
POS v2 API change: NONE
Supabase Auth change: NONE
Store Hub protocol/schema change: NONE
Android cleartext policy change: NONE
```

The stored Store Hub SecureStore record is retained and inactive. Existing
Hub SQLite replica/cache rows are retained. No cursor, outbox entry, checkout
intent, receipt, recovery row, device sequence, credential, or unresolved
transaction is removed or rewritten.

## Security and custody impact

- Deferred releases stop before reading the Hub token or initiating network
  work.
- Manual save and removal calls fail closed while the feature is deferred.
- Android production builds continue to reject global cleartext traffic.
- Isolated cash acceptance and cloud reconciliation retain their existing
  authorization, identity, idempotency, and custody rules.
- Hub ACK remains incapable of marking a cloud outbox event synchronized.

## Tests and exact results

```text
pnpm test:mobile-mob-11-release-scope
PASS — 3 tests, 0 failures

node --test scripts/phase-15-slice-01-store-hub-service-check.mjs scripts/phase-15-slice-02-mobile-hub-config-check.mjs scripts/phase-15-slice-03-store-local-sync-check.mjs scripts/phase-15-store-local-mode-check.mjs
PASS — 4 tests, 0 failures

pnpm test:mobile-a39-store-hub-resilience
PASS — 3 tests, 0 failures

pnpm test:mobile-a40-store-hub-transport
PASS — 3 tests, 0 failures

pnpm test:phase-16-isolated-device-mode
PASS — 1 test, 0 failures

pnpm mobile:typecheck
PASS

pnpm typecheck
PASS

pnpm --dir apps/mobile lint
PASS — 0 errors, 1 pre-existing warning

pnpm lint
PASS — 0 errors, 3 pre-existing warnings

pnpm mobile:export:android
PASS — Hermes Android bundle, 1,451 modules

pnpm certify:static
156/158 automated package commands passed. The Phase 14 final-recovery and
Phase 04 Docker-source-connectivity checks could not run because the local
Supabase source was unavailable. No MOB-11 or Store Hub test failed.

git diff --check
PASS
```

The attempted alias `pnpm test:phase-15-store-local-mode` does not exist in
the package manifest. The four canonical Phase 15 scripts were therefore run
directly as recorded above.

## Acceptance status

| Acceptance ID | Status | Result |
| --- | --- | --- |
| A39 | `BLOCKED` | Physical direct-LAN/WAN evidence is still unavailable. |
| A40 | `BLOCKED` | Trusted merchant hostname/certificate and release-build evidence are still unavailable. |

MOB-11 first-release scope decision: **COMPLETE — STORE HUB DEFERRED**.

MOB-11 production Store Hub certification: **DEFERRED / NOT CERTIFIED**.

## Reopening requirements

Before Store Hub can enter a later release, change the release-scope decision
in a dedicated reviewed slice and complete secure pairing, token rotation,
installation/startup supervision, journal capacity/retention, update
operations, direct multi-device LAN/WAN testing, and trusted-certificate
release-build evidence. Resume A39 and A40; do not reuse this deferral as a
pass.

## Next smallest safe slice

Proceed to MOB-12. Explicitly define the first-release hardware support matrix.
Unavailable or uncertified printers, HID scanners, cash drawers, and payment
terminals must remain unsupported and unadvertised until their physical
acceptance evidence passes.
