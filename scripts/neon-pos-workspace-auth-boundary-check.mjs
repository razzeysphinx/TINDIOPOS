import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migrationPath =
  "supabase/migrations/20260930020000_neon_pos_workspace_auth_boundary_repair.sql";

const migration =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

test(
  "Neon POS workspace repair uses provider-neutral identity",
  () => {
    assert.match(
      migration,
      /private\.current_profile_id\(\)/,
    );

    assert.match(
      migration,
      /private\.has_store_read_scope/,
    );

    assert.match(
      migration,
      /private\.has_permission/,
    );

    assert.doesNotMatch(
      migration,
      /\bauth\.uid\s*\(/i,
      "Certification repair must not reintroduce direct auth.uid() access.",
    );
  },
);

test(
  "legacy catalog RPC is protected by the TINDIO workspace boundary",
  () => {
    assert.match(
      migration,
      /create or replace function public\.search_pos_catalog[\s\S]*security definer/i,
    );

    assert.match(
      migration,
      /perform private\.require_pos_workspace_access/,
    );

    assert.match(
      migration,
      /target_organization_id/,
    );

    assert.match(
      migration,
      /target_store_id/,
    );
  },
);

test(
  "repair does not contain merchant-row mutation",
  () => {
    const catalogStart =
      migration.indexOf(
        "create or replace function public.search_pos_catalog",
      );

    assert.ok(
      catalogStart >= 0,
    );

    const catalogDefinition =
      migration.slice(
        catalogStart,
      );

    assert.doesNotMatch(
      catalogDefinition,
      /\b(?:insert\s+into|update\s+public\.|delete\s+from|truncate\s+table)\b/i,
      "Catalog repair must remain read-only.",
    );
  },
);
