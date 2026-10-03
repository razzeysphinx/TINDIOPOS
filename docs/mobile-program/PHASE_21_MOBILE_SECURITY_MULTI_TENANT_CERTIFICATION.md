# Phase 21 — Mobile Security + Multi-Tenant Certification

## Source-of-Truth gate

```text
Cloud and local-storage tenant isolation certified.
```

## Attack surface

Phase 21 evaluates:

- Business A → Business B
- Store A → unauthorized Store B
- tampered organization ID
- tampered store ID
- tampered employee ID
- tampered device ID
- replayed credentials / transaction replay
- stale offline authorization
- revoked device
- privilege escalation
- modified offline payload

## Cloud authority

Mobile requests do not control employee authority.

Employee, permission, and organization authority come from authenticated server BusinessContext.

Sync requires:

```text
request organization
=
authenticated organization
```

Device identity is independently validated by the server/database.

Offline transaction replay is guarded by:

- stable idempotency keys
- device sequence
- server checkpoints
- device/store/register binding

## Local cache isolation

Local business data is stored with explicit organization scope.

Store-sensitive domains also use store scope.

Certified domains:

```text
products      organization + store
customers     organization + store
receipts      organization
inventory     organization + store
events        organization + store/device
configuration organization
```

## Outbox hardening

Phase 21 removes event-ID-only mutation.

Outbox state mutation now requires:

```text
organization_id
+
event_id
```

This prevents an unnecessary local cross-tenant mutation surface.

## Store Hub

Store Hub payload application validates:

```text
organization
store
```

before persisting peer events.

A mismatched payload fails closed.

## Delta sync

Catalog delta application validates that every catalog delta belongs to the requested store.

A cross-store delta fails closed instead of being rewritten or imported.

## Device secrets

Device secrets remain in secure storage.

They are not stored in transaction outbox payloads.

Device secure-storage keys are organization-scoped.

## Stale authorization

Offline grants continue to enforce:

- expiry
- clock rollback detection
- organization identity
- employee/profile identity
- device identity
- store/register binding
- active shift

## Privilege escalation

Security remains server/database enforced.

Phase 21 does not replace:

- RBAC
- RLS
- store assignments
- device validation

with client-only checks.

## Database certification suites

Phase 21 re-runs:

- provider-neutral core authorization
- multi-tenant readiness
- security boundary hardening
- device/register management
- offline sync foundation
- owner/store access isolation

## Database migration

```text
NONE
```

## SQLite migration

```text
NONE
```

## Certification status

Automated cloud/database and source-contract checks may pass in this phase.

Real-device/local-storage adversarial runtime testing may still be deferred.

Do not claim full certification unless the required executed evidence exists.

## Phase status

Expected after automated implementation:

```text
PHASE 21
IMPLEMENTATION COMPLETE
STATUS: VALIDATING
CERTIFICATION: NOT CERTIFIED
```

Next canonical phase:

```text
PHASE 22 — PERFORMANCE + DATABASE COST CERTIFICATION
```