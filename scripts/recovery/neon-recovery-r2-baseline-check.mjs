import assert from "node:assert/strict";

import {
  createHash,
} from "node:crypto";

import {
  readFileSync,
} from "node:fs";

import test from "node:test";

const BASELINE =
  "database/baseline/0001_tindio_baseline.sql";

const MANIFEST =
  "database/baseline/0001_tindio_baseline.manifest.json";

const sql =
  readFileSync(
    BASELINE,
    "utf8",
  );

const manifest =
  JSON.parse(
    readFileSync(
      MANIFEST,
      "utf8",
    ),
  );

function sha256(
  value,
) {
  return createHash(
    "sha256",
  )
    .update(
      value,
    )
    .digest(
      "hex",
    );
}

function createTablePattern(
  table,
) {
  return new RegExp(
    `CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+(?:(?:"public"|public)\\s*\\.\\s*)?(?:"${table}"|${table})(?=\\s|\\()`,
    "i",
  );
}

function withoutDollarQuotedBodies(value) {
  return value.replace(
    /\$([A-Za-z_][A-Za-z0-9_]*)\$[\s\S]*?\$\1\$|\$\$[\s\S]*?\$\$/g,
    (body) => body.replace(/[^\n]/g, " "),
  );
}

function executableSchemaSql(value) {
  return withoutDollarQuotedBodies(value)
    .replace(/^\s*--.*$/gm, "");
}

test(
  "R2 manifest matches the canonical baseline bytes",
  () => {
    assert.equal(
      manifest.formatVersion,
      1,
    );

    assert.equal(
      manifest.source,
      "CERTIFIED_LOCAL_SUPABASE_POSTGRESQL",
    );

    assert.equal(
      manifest.baselineSha256,
      sha256(
        sql,
      ),
    );

    assert.equal(
      manifest.baselineBytes,
      Buffer.byteLength(
        sql,
        "utf8",
      ),
    );
  },
);

test(
  "R2 baseline contains the protected TINDIO core",
  () => {
    for (
      const table
      of [
        "organizations",
        "stores",
        "employees",
        "roles",
        "permissions",
        "role_permissions",
        "products",
        "inventory_levels",
        "inventory_movements",
        "inventory_counts",
        "stock_transfers",
        "purchase_orders",
        "sales",
        "payments",
        "receipts",
        "shifts",
        "pos_devices",
        "offline_sync_events",
      ]
    ) {
      assert.match(
        sql,
        createTablePattern(
          table,
        ),
        `Missing protected core table: ${table}`,
      );
    }
  },
);

test(
  "R2 baseline includes current R1 winning function definitions",
  () => {
    assert.match(
      sql,
      /FUNCTION\s+(?:"public"\.|public\.)"?get_pos_device_sync_checkpoint"?\s*\(/i,
    );

    assert.match(
      sql,
      /ON\s+CONFLICT\s+ON\s+CONSTRAINT\s+"?pos_device_sync_checkpoints_pkey"?/i,
    );

    assert.match(
      sql,
      /FUNCTION\s+(?:"private"\.|private\.)"?has_active_pos_shift_access"?\s*\(/i,
    );

    assert.match(
      sql,
      /FUNCTION\s+(?:"private"\.|private\.)"?current_identity_subject"?\s*\(/i,
    );

    assert.match(
      sql,
      /FUNCTION\s+(?:"private"\.|private\.)"?current_profile_id"?\s*\(/i,
    );

    assert.match(
      sql,
      /FUNCTION\s+(?:"public"\.|public\.)"?search_pos_catalog"?\s*\(/i,
    );

    assert.match(
      sql,
      /FUNCTION\s+(?:"private"\.|private\.)"?inventory_count_actor"?\s*\(/i,
    );
  },
);

test(
  "R2 baseline excludes provider-owned schema creation and business data",
  () => {
    const executableSql = executableSchemaSql(sql);

    for (
      const providerSchema
      of [
        "auth",
        "storage",
        "realtime",
      ]
    ) {
      assert.doesNotMatch(
        sql,
        new RegExp(
          `CREATE\\s+SCHEMA(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+(?:"${providerSchema}"|${providerSchema})\\b`,
          "i",
        ),
      );

      assert.doesNotMatch(
        sql,
        new RegExp(
          `CREATE\\s+TABLE\\s+(?:"${providerSchema}"|${providerSchema})\\.`,
          "i",
        ),
      );
    }

    assert.doesNotMatch(
      executableSql,
      /^\s*COPY\s+(?:"?(?:public|private)"?\.)/im,
    );

    assert.doesNotMatch(
      executableSql,
      /^\s*INSERT\s+INTO\s+(?:"?(?:public|private)"?\.)/im,
    );
  },
);

test(
  "R2 baseline removes source-cluster administrative ownership",
  () => {
    const executableSql = executableSchemaSql(sql);

    assert.doesNotMatch(
      executableSql,
      /\bOWNER\s+TO\b/i,
    );

    assert.doesNotMatch(
      executableSql,
      /\bSET\s+SESSION\s+AUTHORIZATION\b/i,
    );

    assert.doesNotMatch(
      executableSql,
      /ALTER\s+DEFAULT\s+PRIVILEGES\b[^;]*\bFOR\s+(?:ROLE|USER)\s+"?(?:postgres|supabase_admin)"?/i,
    );
  },
);

test(
  "R2 intentionally records remaining provider coupling for R3 and R4",
  () => {
    assert.equal(
      typeof manifest
        .baselinePortabilityInventory
        .authUidReferences,
      "number",
    );

    assert.equal(
      typeof manifest
        .baselinePortabilityInventory
        .providerRoleReferences,
      "number",
    );

    assert.equal(
      typeof manifest
        .sourceSchemaCounts
        .authUidFunctions,
      "number",
    );

    assert.equal(
      typeof manifest
        .sourceSchemaCounts
        .providerCoupledPolicies,
      "number",
    );
  },
);

test(
  "R2 manifest proves the audited 211-history boundary",
  () => {
    assert.equal(
      manifest
        .migrationEvidence
        .historicalMigrationCount,
      211,
    );

    assert.ok(
      manifest
        .migrationEvidence
        .recoveryForwardMigrationCount
        >= 2,
    );

    assert.equal(
      manifest
        .migrationEvidence
        .activeMigrationCount,
      211
        + manifest
          .migrationEvidence
          .recoveryForwardMigrationCount,
    );
  },
);
