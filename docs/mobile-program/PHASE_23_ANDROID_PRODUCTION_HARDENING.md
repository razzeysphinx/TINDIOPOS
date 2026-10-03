# Phase 23 — Android Production Hardening

## Implementation status

IMPLEMENTATION COMPLETE

## Certification status

VALIDATING

## Source-of-Truth gate

```text
Version upgrade/restart/recovery behavior certified.
```

## Implemented

- Android package ID
- Android version code
- EAS production AAB profile
- remote signing-credential policy
- explicit permission policy
- Android backup disabled
- SecureStore backup handling retained
- production HTTPS enforcement
- production cleartext traffic disabled
- root crash boundary
- upgrade preservation proof
- privacy/data map
- binary application update policy
- SQLite migration safety contract
- backward-compatibility policy

## Package

```text
com.tindio.pos
```

## Signing

Repository contains no signing secrets.

Production signing uses EAS remote credentials.

## Updates

Production updates use Google Play binary releases.

JavaScript-only OTA updates are intentionally not enabled because SQLite schema/application rollback compatibility has not been independently certified.

## Critical transaction rule

Application restart, crash, or binary upgrade must not delete or rewrite unresolved durable outbox transactions.

Upgrade proof verifies:

- event exists
- same organization scope
- same event ID
- same idempotency key
- same device sequence
- same payload/snapshot digest

## Database impact

Server database migration:

```text
NONE
```

SQLite migration:

```text
NONE
```

Phase 23 hardens migration behavior but does not change the local schema.

## Certification still required on Android

1. development APK
2. create unresolved synthetic offline sale
3. arm upgrade proof
4. install newer build over existing build
5. relaunch
6. verify upgrade proof
7. verify SQLite schema
8. verify crash/restart recovery
9. reconnect
10. sync exactly once
11. verify no duplicate money
12. verify no duplicate inventory movement

## Release build

A signed production AAB requires external EAS project/signing credentials.

If those credentials are not available to the execution environment:

```text
RELEASE BUILD = DEFERRED_CREDENTIALS
```

Never invent signing credentials.

## Phase status

```text
PHASE 23
IMPLEMENTATION COMPLETE
STATUS: VALIDATING
CERTIFICATION: NOT CERTIFIED
```

Next canonical phase:

```text
PHASE 24 — GOOGLE PLAY TESTING + RELEASE
```