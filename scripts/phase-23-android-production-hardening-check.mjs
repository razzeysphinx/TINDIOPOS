import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) =>
  fs.readFileSync(
    path,
    "utf8",
  );

test(
  "Phase 23 Android production configuration is hardened",
  () => {
    const app =
      JSON.parse(
        read(
          "apps/mobile/app.json",
        ),
      ).expo;

    const eas =
      JSON.parse(
        read(
          "apps/mobile/eas.json",
        ),
      );

    const dynamicConfig =
      read(
        "apps/mobile/app.config.js",
      );

    assert.equal(
      app.android.package,
      "com.tindio.pos",
    );

    assert.ok(
      Number.isInteger(
        app.android.versionCode,
      )
      && app.android.versionCode >= 1,
    );

    assert.equal(
      app.android.allowBackup,
      false,
    );

    assert.ok(
      app.android.permissions.includes(
        "android.permission.CAMERA",
      ),
    );

    assert.ok(
      app.android.blockedPermissions.includes(
        "android.permission.RECORD_AUDIO",
      ),
    );

    assert.equal(
      eas.build.production.android.buildType,
      "app-bundle",
    );

    assert.equal(
      eas.build.production.android.credentialsSource,
      "remote",
    );

    assert.equal(
      eas.build.production.autoIncrement,
      true,
    );

    assert.ok(
      dynamicConfig.includes(
        "EAS_BUILD_PROFILE",
      )
      && dynamicConfig.includes(
        "usesCleartextTraffic: false",
      ),
      "production builds must disable cleartext traffic",
    );
  },
);

test(
  "Phase 23 uses secure storage and HTTPS production enforcement",
  () => {
    const secureStorage =
      read(
        "apps/mobile/src/lib/secure-storage.ts",
      );

    const supabase =
      read(
        "apps/mobile/src/lib/supabase.ts",
      );

    const environment =
      read(
        "apps/mobile/src/lib/env.ts",
      );

    assert.ok(
      secureStorage.includes(
        "expo-secure-store",
      ),
    );

    assert.ok(
      supabase.includes(
        "storage: secureStorage",
      ),
    );

    assert.ok(
      environment.includes(
        'url.protocol !== "https:"',
      ),
      "production URLs must require HTTPS",
    );

    assert.doesNotMatch(
      environment,
      /service_role|DATABASE_URL|secret_key/i,
      "mobile public environment must not include privileged server secrets",
    );
  },
);

test(
  "Phase 23 crash handling preserves local transaction custody",
  () => {
    const boundary =
      read(
        "apps/mobile/src/features/runtime/production-error-boundary.tsx",
      );

    const root =
      read(
        "apps/mobile/app/_layout.tsx",
      );

    assert.ok(
      root.includes(
        "ProductionErrorBoundary",
      ),
    );

    assert.doesNotMatch(
      boundary,
      /clearOrganizationLocalCache|DELETE FROM outbox_events|signOut\(|removeItem\(/,
      "crash boundary must not clear transaction/session storage",
    );
  },
);

test(
  "Phase 23 SQLite migration runner remains transactional and non-destructive",
  () => {
    const database =
      read(
        "apps/mobile/src/db/database.ts",
      );

    const schema =
      read(
        "apps/mobile/src/db/schema.ts",
      );

    const migrationSqlIndex =
      database.indexOf(
        "transaction.execAsync(migration.sql)",
      );

    const versionWriteIndex =
      database.indexOf(
        "transaction.execAsync(`PRAGMA user_version = ${migration.version}`)",
      );

    assert.ok(
      database.includes(
        "withExclusiveTransactionAsync",
      )
      && migrationSqlIndex >= 0
      && versionWriteIndex >= 0
      && migrationSqlIndex
        < versionWriteIndex,
    );

    assert.doesNotMatch(
      schema,
      /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?outbox_events|DELETE\s+FROM\s+outbox_events|TRUNCATE\s+(?:TABLE\s+)?outbox_events/i,
      "SQLite migrations must never destroy durable outbox events",
    );
  },
);

test(
  "Phase 23 upgrade proof verifies durable transaction identity and content",
  () => {
    const proof =
      read(
        "apps/mobile/src/features/runtime/app-upgrade-proof.ts",
      );

    for (
      const marker of [
        "organization_id=?",
        "event_id=?",
        "idempotency_key",
        "device_sequence",
        "payload_json",
        "snapshot_json",
        "SHA256",
        "EVENT_MISSING",
        "EVENT_IDENTITY_CHANGED",
        "EVENT_CONTENT_CHANGED",
      ]
    ) {
      assert.ok(
        proof.includes(marker),
        `upgrade proof must include ${marker}`,
      );
    }
  },
);

test(
  "Phase 23 deliberately uses binary application updates",
  () => {
    const mobilePackage =
      JSON.parse(
        read(
          "apps/mobile/package.json",
        ),
      );

    assert.equal(
      Boolean(
        mobilePackage
          .dependencies
          ?.[
            "expo-updates"
          ],
      ),
      false,
      "Phase 23 must not silently introduce JS-only OTA updates",
    );

    const policy =
      read(
        "docs/mobile-program/PHASE_23_ANDROID_RELEASE_UPDATE_POLICY.md",
      );

    assert.ok(
      policy.includes(
        "Google Play binary updates",
      )
      && policy.includes(
        "Do not publish a binary rollback",
      ),
    );
  },
);