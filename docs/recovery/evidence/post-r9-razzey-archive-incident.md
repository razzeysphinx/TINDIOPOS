# Post-R9 RAZZEY archive incident — read-only attestation

Captured: 2026-10-05

## Scope

This record preserves the observed production state after an archive lifecycle
workflow was applied to the RAZZEY control tenant instead of the intended
certification tenant. It is read-only evidence; it authorizes and performs no
recovery, reactivation, deletion, data rewrite, or lifecycle action.

## Canonical target

```text
Neon project: divine-sound-41148108
Neon branch: br-snowy-heart-b5nf6q3n
Database: tindio_r6_recovery
```

## Observed lifecycle state

| Organization | ID | Status | Archive requested | Archived at |
| --- | --- | --- | --- | --- |
| RAZZEY TRADING CORP. | `82643062-7d18-4f5a-b6a6-fc5da64bd810` | archived | 2026-10-05T14:34:56.755268Z | 2026-10-05T14:35:49.375768Z |
| TINDIO Phase 04 Certification | `baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9` | active | null | null |

The control tenant archive used the existing canonical lifecycle. Its observed
audit sequence was archive request, two delivered organization exports, and
the archive lifecycle event. The archive reason was the Post-R9 certification
tenant retirement reason; this record does not reproduce credentials, export
contents, session material, or actor identifiers.

## Preservation snapshot

RAZZEY retains its organization row, one active employee membership, one store,
one register, 14 organization-feature rows, and seven audit-log rows. It has
no sales, sale items, payments, receipts, refunds, inventory counts,
inventory-count lines, or inventory movements. The archive did not delete its
business-history or identity linkage.

The linked Supabase Auth user was read-only verified as confirmed, enabled,
and not deleted. Supabase `public` and `private` business-table count remains
zero; canonical Neon remains the business data authority.

## Required follow-up

The canonical lifecycle deliberately treats an archived organization as
non-reactivatable. No direct status update, database-owner bypass, deletion,
or ad-hoc restoration is authorized. A separate explicit recovery decision is
required before any RAZZEY recovery implementation.

The certification-tenant archive workflow is blocked until the RAZZEY incident
is explicitly resolved or a later authority packet revises the control-tenant
requirement.
