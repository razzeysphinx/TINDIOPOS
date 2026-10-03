# Phase 23 — Android Privacy + Data Map

## Android package

```text
com.tindio.pos
```

## Requested Android permissions

### Camera

Purpose:

```text
Product barcode scanning
```

Camera is not used for:

- identity recognition
- background recording
- audio recording

## Explicitly blocked permissions

- microphone / RECORD_AUDIO
- audio media library
- video media library

TINDIO does not request location, contacts, or broad storage access in Phase 23.

## Local application data

SQLite may contain tenant-scoped operational data required for offline POS behavior:

- business context
- catalog
- reference configuration
- customer cache
- shift snapshot
- receipt summaries
- stock estimates
- modifier cache
- durable transaction outbox
- sync cursors
- device sequence/checkpoint state
- Store Hub coordination state

## Secure storage

SecureStore is used for authentication/session and device-secret storage.

Device secrets are not placed in SQLite outbox events.

## Android backup

Application backup is disabled for the production app.

SecureStore Android backup exclusion remains configured.

## Payments

TINDIO does not store:

- PAN
- CVV/CVC
- PIN
- PIN block
- magnetic stripe track data
- raw NFC payload

## Telemetry / crash handling

Crash handling does not print:

- transaction payloads
- access tokens
- device secrets
- payment credentials

Phase 26 will add production observability while preserving this rule.