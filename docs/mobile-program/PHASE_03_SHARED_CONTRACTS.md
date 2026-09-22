# TINDIO Mobile Program — Phase 03

## Shared Contracts

SOURCE_OF_TRUTH:
`docs/TINDIO_MOBILE_NEON_SOURCE_OF_TRUTH.md`

PHASE:
`03 — Shared Contracts`

STATUS:
`CERTIFIED`

## Canonical Backend V1 contract

The canonical client-safe POS v1 contract is:

```text
src/contracts/pos-v1.ts
```

It reuses existing proven schemas/types instead of creating parallel definitions.

## Shared request contracts

The contract exposes or re-exports:

- checkout
- offline checkout metadata
- stock validation
- device credential/validation
- customer creation
- shift open/close/cash movement
- time clock
- manager approval
- refund
- digital receipt delivery
- open-ticket save/cancel/move/split/merge
- POS favorites
- catalog/customer/modifier/receipt queries
- shared UUID path validation

## Shared response/DTO contracts

The contract exposes:

- bootstrap response
- workspace DTO
- catalog DTO
- customer DTO
- receipt summary/detail DTO
- device binding
- modifier DTO
- checkout result
- stock-validation result
- POS presentation types

## Deliberate deferrals

The following are not invented in Phase 03 because their architecture is not implemented yet:

```text
OfflineEvent
Generic Outbox
Device Sequence
Server Checkpoint
SyncAck
SyncCursor
Delta Change Feed
```

Those contracts are introduced with their owning implementation phases.

## Packaging decision

Phase 03 does not create a monorepo workspace package because no mobile workspace exists yet.

The contract is canonical now.

When the native app is created, it must consume this contract or move this exact contract into a shared workspace package without redefining the shapes.

## Database impact

```text
DATABASE_MIGRATIONS_ADDED: 0
GENERATED_DB_TYPES_CHANGED: NO
DEPENDENCIES_ADDED: 0
```

## CI optimization

Feature-branch pushes no longer duplicate full GitHub certification.

Full certification runs on:

```text
pull request → TINDIO-PREPRODUCTION
push/merge → TINDIO-PREPRODUCTION
```

Local validation remains mandatory before opening the PR.

## Compatibility regression coverage

Phase 03 explicitly re-runs:

```text
test:inventory-offline-integrity
```

because POS catalog pagination moved from the route-local schema into the canonical shared contract.

The test now verifies the same 24-item upper bound at its new source of truth instead of requiring duplicated route-local schema code.

## Completion record

```text
PHASE_STATUS: CERTIFIED
BASE_BRANCH: TINDIO-PREPRODUCTION
BASE_SHA: 698f9838577e1e98f93f6f4ddaf08eee9bcf8012
PHASE_BRANCH: mobile/phase-03-shared-contracts

SHARED_POS_CONTRACT: PASS
TICKET_SCHEMAS_CLIENT_SAFE: PASS
ROUTE_QUERY_SCHEMAS_SHARED: PASS
WORKSPACE_DTO_SHARED: PASS
RECEIPT_DTO_SHARED: PASS
PRIOR_PHASE_CONTRACTS: PASS

DATABASE_MIGRATIONS_ADDED: 0
GENERATED_DB_TYPES_CHANGED: NO
DEPENDENCIES_ADDED: 0
```
