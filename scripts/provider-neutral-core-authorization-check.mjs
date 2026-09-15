import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationsDirectory =
  new URL("../supabase/migrations/", import.meta.url);

const migrationNames = await readdir(migrationsDirectory);

const migrations = migrationNames.filter((name) =>
  name.endsWith(
    "_provider_neutral_core_authorization_runtime.sql",
  ),
);

assert.equal(
  migrations.length,
  1,
  `Expected one R3.5 authorization runtime migration; found ${migrations.length}.`,
);

const migration = await readFile(
  new URL(
    `../supabase/migrations/${migrations[0]}`,
    import.meta.url,
  ),
  "utf8",
);

function definition(name) {
  const match = migration.match(
    new RegExp(
      `create or replace function private\\.${name}\\([\\s\\S]*?\\$\\$;`,
      "i",
    ),
  );

  assert.ok(match, `Missing private.${name}.`);
  return match[0];
}

function body(name) {
  const match = definition(name).match(
    /as\s+\$\$([\s\S]*?)\$\$;/i,
  );

  assert.ok(match, `Unable to extract ${name} body.`);
  return match[1];
}

const approvedFunctions = [
  "current_employee_id",
  "is_organization_creator",
  "is_organization_member",
  "has_permission",
  "can_view_employee_profile",
  "activate_manager_approval",
];

test("R3.5 contains no provider-specific authentication primitive", () => {
  assert.equal(
    (migration.match(/auth\.uid\(\)/g) ?? []).length,
    0,
  );

  assert.equal(
    (
      migration.match(
        /private\.current_identity_subject\(\)/g,
      ) ?? []
    ).length,
    0,
  );
});

test("R3.5 replaces exactly the approved runtime functions", () => {
  const created = [
    ...migration.matchAll(
      /create or replace function private\.([a-z0-9_]+)\(/gi,
    ),
  ].map((match) => match[1]);

  assert.deepEqual(
    created.sort(),
    [...approvedFunctions].sort(),
  );

  assert.doesNotMatch(
    migration,
    /\b(create|alter|drop)\s+policy\b/i,
  );

  assert.doesNotMatch(
    migration,
    /alter table public\./i,
  );
});

test("employee and organization authorization preserve active-tenant semantics", () => {
  assert.match(
    body("current_employee_id"),
    /organization\.status = 'active'/,
  );

  assert.match(
    body("current_employee_id"),
    /employee\.profile_id[\s\S]*private\.current_profile_id\(\)/,
  );

  assert.match(
    body("is_organization_creator"),
    /organization\.created_by[\s\S]*private\.current_profile_id\(\)/,
  );

  assert.match(
    body("is_organization_creator"),
    /organization\.status = 'active'/,
  );

  assert.match(
    body("is_organization_member"),
    /organization\.status = 'active'/,
  );

  assert.match(
    body("is_organization_member"),
    /employee\.profile_id[\s\S]*private\.current_profile_id\(\)/,
  );
});

test("permission and profile visibility preserve later security semantics", () => {
  const permission = body("has_permission");
  const profile = body("can_view_employee_profile");

  assert.match(
    permission,
    /organization\.status = 'active'/,
  );

  assert.match(
    permission,
    /role_permission\.permission_code = requested_permission/,
  );

  assert.match(
    permission,
    /tindio\.approval_profile_id/,
  );

  assert.match(
    permission,
    /tindio\.approval_organization_id/,
  );

  assert.match(
    permission,
    /tindio\.approval_permission/,
  );

  assert.match(
    permission,
    /private\.current_profile_id\(\)/,
  );

  assert.match(
    profile,
    /target_profile_id[\s\S]*private\.current_profile_id\(\)/,
  );

  assert.match(
    profile,
    /private\.has_permission/,
  );

  assert.match(
    profile,
    /private\.can_access_employee_store_scope/,
  );
});

test("manager approval context stores TINDIO profile identity", () => {
  const approval = body("activate_manager_approval");

  assert.match(
    approval,
    /private\.current_employee_id/,
  );

  assert.match(
    approval,
    /request\.status = 'CONSUMED'/,
  );

  assert.match(
    approval,
    /request\.status = 'APPROVED'/,
  );

  assert.match(
    approval,
    /APPROVAL_CONSUMED/,
  );

  assert.match(
    approval,
    /set_config\([\s\S]*'tindio\.approval_profile_id'[\s\S]*private\.current_profile_id\(\)/,
  );

  assert.doesNotMatch(
    approval,
    /auth\.uid\(\)/,
  );
});

test("manager approval remains internal while authorization helpers remain callable by authenticated", () => {
  for (const name of [
    "current_employee_id",
    "is_organization_creator",
    "is_organization_member",
    "has_permission",
    "can_view_employee_profile",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `grant execute[\\s\\S]*private\\.${name}`,
        "i",
      ),
    );
  }

  assert.match(
    migration,
    /revoke execute[\s\S]*private\.activate_manager_approval/,
  );

  assert.doesNotMatch(
    migration,
    /grant execute[\s\S]*private\.activate_manager_approval[\s\S]*to authenticated/i,
  );
});
