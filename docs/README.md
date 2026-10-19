# TINDIO Documentation Index

This index provides taxonomy without moving stable canonical or evidence paths.
Historical links, certification scripts, and recovery contracts rely on several
existing locations, so discoverability is preferred over cosmetic relocation.

## Current architecture and product

- [Architecture modernization target](architecture/TINDIO_TARGET_ARCHITECTURE.md)
- [Current architecture audit](architecture/TINDIO_CURRENT_ARCHITECTURE_AUDIT.md)
- [Dependency map](architecture/TINDIO_DEPENDENCY_MAP.md)
- [Migration sequence](architecture/TINDIO_MIGRATION_SEQUENCE.md)
- [Production cutover checklist](architecture/TINDIO_PRODUCTION_CUTOVER_CHECKLIST.md)
- [Architecture certification](architecture/TINDIO_ARCHITECTURE_CERTIFICATION.md)
- [ADR-0001: Neon-only identity and dedicated backend target](architecture/ADR-0001-neon-only-auth-and-backend-boundary.md)
- [Architecture](architecture.md)
- [Backup, recovery, and data governance](backup-recovery-and-data-governance.md)
- [Mobile + Neon source of truth](TINDIO_MOBILE_NEON_SOURCE_OF_TRUTH.md)
- [RBAC permission audit](TINDIO_RBAC_PERMISSION_AUDIT.md)
- [RBAC permission matrix](TINDIO_RBAC_PERMISSION_MATRIX.md)
- [Page capability matrix](TINDIO_PAGE_CAPABILITY_MATRIX.md)

## Repository operation

- [Repository structure](repository/REPOSITORY_STRUCTURE.md)
- [Cleanup audit](repository/REPOSITORY_CLEANUP_AUDIT.md)
- [Deprecations and compatibility](repository/DEPRECATIONS.md)
- [Machine-readable inventory](repository/repository-inventory.json)

## Mobile program

Use [mobile-program/README.md](mobile-program/README.md) for phase reports,
implementation slices, release documents, operations, and evidence.

## Recovery

`recovery/` is protected historical and operational recovery material. Start at
[the recovery source of truth](recovery/TINDIO_NEON_RECOVERY_SOURCE_OF_TRUTH.md).
Evidence beneath `recovery/evidence/` remains distinct and must not be merged or
deleted merely because later phases produced similar files.

## Archived material

- `archive/plans/` contains implemented historical product plans and an old-to-
  new path/status index.
- Root documents prefixed `TINDIO_FINAL_PREPRODUCTION_*` and handovers remain at
  stable paths where moving them would add broad historical-link churn. Their
  status is documented by the repository inventory.
