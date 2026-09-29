# Phase 17 — Sync Control Center 2.0

## Status

IMPLEMENTING

## Source-of-Truth goal

Upgrade the existing Back Office Offline Sync Center so synchronization problems cannot silently remain invisible.

Required visibility:

- organization
- store
- register
- device
- employee
- connection mode
- app version
- last heartbeat
- last successful sync
- device checkpoint
- server checkpoint
- queue depth
- conflicts
- offline duration

Required modes:

- CLOUD_ONLINE
- STORE_LOCAL
- DEVICE_ISOLATED
- RECOVERING
- SYNC_REVIEW

## Slice plan

1. Server telemetry contract and heartbeat API
2. Native heartbeat/telemetry reporter
3. Back Office Sync Control Center 2.0 UI
4. Attention classification, hardening and implementation close

## Slice 01

Added tenant/store-scoped server telemetry and a validated POS heartbeat endpoint.

Telemetry does not change sale or inventory authority.

Phase 17 remains IMPLEMENTING.
