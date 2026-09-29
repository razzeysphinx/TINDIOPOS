import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) =>
  fs.readFileSync(
    path,
    "utf8",
  );

test(
  "Phase 22 mobile performance instrumentation exists without payload logging",
  () => {
    const metrics =
      read(
        "apps/mobile/src/features/performance/performance-metrics.ts",
      );

    const api =
      read(
        "apps/mobile/src/lib/tindio-api.ts",
      );

    const catalog =
      read(
        "apps/mobile/src/features/local-first/local-catalog.ts",
      );

    const reconcile =
      read(
        "apps/mobile/src/features/sync/reconcile-cloud.ts",
      );

    const outbox =
      read(
        "apps/mobile/src/features/outbox/outbox-sync.ts",
      );

    for (
      const marker of [
        "apiCallsPerHour",
        "apiAverageLatencyMs",
        "apiResponseBytes",
        "sqliteAverageLatencyMs",
        "syncThroughputPerSecond",
        "recoveryAverageDurationMs",
        "realtimeConnections",
      ]
    ) {
      assert.ok(
        metrics.includes(marker),
        `performance metrics must expose ${marker}`,
      );
    }

    assert.ok(
      api.includes(
        "recordApiCall",
      ),
      "API wrapper must record request cost",
    );

    assert.ok(
      catalog.includes(
        "recordSqliteQuery",
      ),
      "SQLite catalog path must record query latency",
    );

    assert.ok(
      reconcile.includes(
        "recordSyncRun",
      ),
      "cloud reconcile must record sync throughput",
    );

    assert.ok(
      outbox.includes(
        "recordRecoveryRun",
      ),
      "outbox recovery must record recovery duration",
    );

    assert.doesNotMatch(
      metrics + api,
      /access_token\s*[:=]|Authorization.*console|payload_json.*console/i,
      "performance instrumentation must not log sensitive payload/token content",
    );
  },
);

test(
  "Phase 22 database cost tooling measures actual database activity",
  () => {
    const snapshot =
      read(
        "scripts/phase-22-cost-snapshot.mjs",
      );

    const diff =
      read(
        "scripts/phase-22-cost-diff.mjs",
      );

    for (
      const marker of [
        "pg_stat_database",
        "pg_stat_user_tables",
        "pg_stat_activity",
        "pg_stat_statements",
      ]
    ) {
      assert.ok(
        snapshot.includes(marker),
        `cost snapshot must inspect ${marker}`,
      );
    }

    for (
      const marker of [
        "seq_tup_read",
        "idx_tup_fetch",
        "calls",
        "totalExecTimeMs",
        "rows",
      ]
    ) {
      assert.ok(
        diff.includes(marker),
        `cost diff must expose ${marker}`,
      );
    }
  },
);

test(
  "Phase 22 does not add speculative database optimization",
  () => {
    const stagedTargets = [
      "apps/mobile/src/features/performance/performance-metrics.ts",
      "apps/mobile/src/lib/tindio-api.ts",
      "apps/mobile/src/features/local-first/local-catalog.ts",
      "apps/mobile/src/features/outbox/outbox-sync.ts",
      "apps/mobile/src/features/sync/reconcile-cloud.ts",
    ]
      .map(read)
      .join("\n");

    assert.doesNotMatch(
      stagedTargets,
      /CREATE\s+INDEX|DROP\s+INDEX|ALTER\s+TABLE/i,
      "Phase 22 measurement instrumentation must not invent database tuning",
    );
  },
);