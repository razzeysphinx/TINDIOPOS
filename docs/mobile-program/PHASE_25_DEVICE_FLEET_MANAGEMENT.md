# Phase 25 — Device Fleet Management

## Source-of-Truth gate

```text
Owners can administer many terminals without manual database work.
```

## Fleet capabilities

Back Office now consolidates:

- enroll device
- business assignment visibility
- store assignment
- register assignment
- disable device
- replace device
- app version
- heartbeat
- sync status
- conflict counts
- failed operation counts
- queue depth
- checkpoint gap
- last successful sync
- last contact

## Business assignment

TINDIO does not expose a cross-business device reassignment selector. A device is enrolled under the authenticated organization.

To move physical hardware to another business:

```text
revoke old device
authenticate under new business
generate new credential
enroll as a new device
```

This protects tenant isolation.

## Replacement

Replacement does not clone credentials.

```text
Disable old terminal
↓
Install TINDIO on replacement
↓
Authenticate
↓
Enroll replacement
↓
Assign same/new store
↓
Assign same/new register
↓
Initial sync
↓
Ready
```

The replacement terminal generates a new device ID and new secret.

## Fleet health

The device registry provides status, app version, and last validation contact. Sync Control Center telemetry provides heartbeat, connection mode, last successful sync, queue depth, conflicts, failures, offline duration, and device/server checkpoints. Fleet Management combines those sources without exposing transaction payloads.

## Security

All management remains guarded by `devices.manage`. Device secrets remain in client SecureStore with a private server-side hash. Back Office never reads device secrets.

## Database impact

Server migration: `NONE`

SQLite migration: `NONE`

The existing registry and telemetry schema already satisfy Phase 25.

## Certification

Automated implementation may pass while real fleet operations remain to be exercised during pilot use.

```text
PHASE 25
IMPLEMENTATION COMPLETE
STATUS: VALIDATING
CERTIFICATION: NOT CERTIFIED
```

Next canonical phase: `PHASE 26 — PRODUCTION OBSERVABILITY`.
