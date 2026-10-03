# Phase 24 — Google Play Testing + Release

## Source-of-Truth gate

```text
Production build passes real Android store scenarios.
```

## Implementation status

```text
IMPLEMENTATION COMPLETE
```

after release controls/configuration are committed.

## Certification status

```text
VALIDATING
NOT CERTIFIED
```

until real Google Play and pilot evidence passes.

## Release model

```text
development device
↓
internal testing
↓
closed testing
↓
pilot merchants
↓
production
```

## Production protection

The repository does not configure an automatic completed production rollout.

The production EAS submit profile is:

```text
track: production
releaseStatus: draft
```

The local production evidence gate must pass before production is prepared.

## Current external dependency

Phase 23 reported:

```text
release credentials unavailable
```

If this remains true, signed AAB and Play testing are deferred.

Do not fabricate credentials.

## Real-store gate

Required scenarios include:

- authentication/business context
- device enrollment
- store/register assignment
- initial sync
- online cash
- offline cash
- app kill recovery
- phone restart
- before/after-commit network loss
- missing ACK replay
- reconnect exactly once
- camera barcode
- HID barcode where hardware exists
- tenant isolation
- store isolation
- revoked device
- closed shift
- upgrade with unresolved event
- no duplicate money
- no duplicate inventory movement

## Database impact

Server migration:

```text
NONE
```

SQLite migration:

```text
NONE
```

## Phase status

Expected after repository implementation:

```text
PHASE 24
IMPLEMENTATION COMPLETE
STATUS: VALIDATING
CERTIFICATION: NOT CERTIFIED
```

Next canonical phase after Phase 24 implementation/review:

```text
PHASE 25 — DEVICE FLEET MANAGEMENT
```

Do not globally launch before Phase 24 pilot validation.
