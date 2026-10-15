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

## Personal and business data

The connected TINDIO service may process:

- account profile, authentication identifier and employee contact data;
- roles, store assignments, attendance and shift identity;
- merchant organization, store, register, catalog and inventory data;
- merchant-entered customer identity, contact, loyalty and service data;
- sales, payment, refund, receipt, stock movement and audit history;
- device binding, application version, synchronization/recovery state and aggregate reliability telemetry.

These categories must be reconciled against the exact release artifact and its
included SDKs before the Google Play Data safety form is submitted.

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

## Public access paths

The web application now provides unauthenticated routes for:

```text
/privacy
/support
/account-deletion
```

The Android sign-in and settings screens link to all three routes using the
configured production API/web origin. Production configuration requires HTTPS.

## Account-deletion applicability

Account deletion applies because the connected TINDIO web service provides an
account-creation flow at `/signup`. The Android application itself is sign-in
only, but it uses the same user-facing account identity.

Employee deactivation, suspension, organization archival and removal of a
tenant membership are not represented as deletion of the underlying account.
Official sales, payments, receipts, inventory movements, shifts, approvals and
audit history may require continued retention. When retained, access must be
revoked and personal data minimized where technically and legally appropriate.

## A47 external blockers

The repository does not identify an approved responsible legal entity, privacy
contact, monitored support owner, public production HTTPS origin or effective
date. The public pages disclose this limitation and Phase 24 remains blocked.
Do not set A47 to `PASS` until those values are approved, the deletion-request
channel is operational, the deployed routes are verified without authentication
or geofencing, and matching URLs are entered in Play Console.

Current policy references checked during implementation:

- https://support.google.com/googleplay/android-developer/answer/10144311
- https://support.google.com/googleplay/android-developer/answer/13327111
