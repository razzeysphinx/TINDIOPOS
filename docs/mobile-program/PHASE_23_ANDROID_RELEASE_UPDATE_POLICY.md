# Phase 23 — Android Release + Update Policy

## Package ID

```text
com.tindio.pos
```

Do not publish a different package to Google Play by accident.

## Signing

Android signing uses EAS remote credentials.

Signing secrets are never committed to Git.

## Production artifact

Production Android build target:

```text
AAB
```

Google Play distribution begins in Phase 24.

## Application updates

Production application updates use signed Google Play binary updates.

Phase 23 intentionally does not enable JavaScript-only OTA updates.

Reason:

SQLite schema migrations and application code must remain version-compatible.

## Upgrade rule

Before testing a new binary:

1. Create at least one unresolved synthetic offline transaction in a development/test organization.
2. Open Production Readiness.
3. Arm the upgrade preservation proof.
4. Install the newer binary over the existing app.
5. Do NOT uninstall the old app.
6. Open the newer version.
7. Verify the upgrade preservation proof.
8. Confirm SQLite schema migration succeeded.
9. Confirm the same outbox identity/payload remains.
10. Reconnect and reconcile.
11. Confirm exactly-once server result.

## Forbidden upgrade procedure

Do not use:

```text
uninstall old APK
install new APK
```

as an upgrade certification test.

Uninstall intentionally removes application data and does not represent a store upgrade.

## Migration rule

SQLite migrations must:

- run transactionally
- apply migration SQL before advancing `user_version`
- never recreate the database over unresolved outbox events
- never delete unresolved outbox events
- preserve idempotency key
- preserve device sequence

## Rollback policy

Do not publish a binary rollback whose local schema support is older than the installed schema.

Fix forward with a newer compatible binary.

## Certification

Phase 23 cannot be marked CERTIFIED until a real Android upgrade/restart/recovery test passes.