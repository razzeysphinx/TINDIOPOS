import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const BASELINE = path.join(ROOT, "database/baseline/0001_tindio_baseline.sql");
const MANIFEST = path.join(ROOT, "database/baseline/0001_tindio_baseline.manifest.json");
const MIGRATION_DIR = path.join(ROOT, "database/migrations");
const MIGRATION = path.join(MIGRATION_DIR, "0003_provider_neutral_roles_rls.sql");

const R3_SHA = "2a43bafc014116efde776ee1b66c9e9426c2a6b5fd4c56ffc013f37354e47d43";
const EXPECTED_POLICIES = 149;
const EXPECTED_AUTHENTICATED_POLICIES = 141;
const EXPECTED_PROVIDER_COUPLED_POLICIES = 11;
const EXPECTED_PROVIDER_GRANTS = 532;
const EXPECTED_QUOTED_PROVIDER_ROLES = 682;

const ROLE_MAP = new Map([
  ["authenticated", "tindio_authenticated"],
  ["anon", "tindio_anon"],
  ["service_role", "tindio_service"],
]);

const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");

const count = (source, pattern) =>
  (source.match(pattern) ?? []).length;

const providerAuthPattern = () =>
  /(?:"auth"\s*\.\s*"(?:uid|user_id|jwt|role)"|\bauth\.(?:uid|user_id|jwt|role))\s*\(/gi;

const quotedProviderRolePattern = () =>
  /"(?:authenticated|anon|service_role)"/gi;

function canonicalRoleBootstrap() {
  return `

-- TINDIO-owned database access classes.
do $tindio_roles$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'tindio_anon'
  ) then
    create role tindio_anon nologin inherit;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'tindio_authenticated'
  ) then
    create role tindio_authenticated nologin inherit;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'tindio_service'
  ) then
    create role tindio_service nologin inherit;
  end if;
end;
$tindio_roles$;

alter role tindio_anon nologin inherit;
alter role tindio_authenticated nologin inherit;
alter role tindio_service nologin inherit;
`;
}

function identityEmailMatchHelper({ replace = false } = {}) {
  return `${replace ? "CREATE OR REPLACE" : "CREATE"} FUNCTION "private"."current_identity_email_matches"("target_email" text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $tindio_identity_email$
  select
    private.current_identity_email() is not null
    and lower(trim(coalesce(target_email, '')))
      = private.current_identity_email();
$tindio_identity_email$;

REVOKE ALL
ON FUNCTION "private"."current_identity_email_matches"(text)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION "private"."current_identity_email_matches"(text)
TO "tindio_authenticated";`;
}

function functions(source) {
  const startPattern =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*))\s*\(/gi;

  const blocks = [];

  for (const match of source.matchAll(startPattern)) {
    const start = match.index ?? 0;
    const remainder = source.slice(start);
    const asMatch = /\bAS\s+(\$[A-Za-z0-9_]*\$)/i.exec(remainder);

    assert.ok(asMatch, `Missing function body delimiter: ${match[1]}`);

    const delimiter = asMatch[1];
    const bodyStart = start + (asMatch.index ?? 0) + asMatch[0].length;
    const bodyEnd = source.indexOf(delimiter, bodyStart);

    assert.ok(bodyEnd >= 0, `Missing closing function delimiter: ${match[1]}`);

    const semicolon = source.indexOf(";", bodyEnd + delimiter.length);
    assert.ok(semicolon >= 0, `Missing function terminator: ${match[1]}`);

    blocks.push({
      name: match[1].replaceAll('"', "").replace(/\s+/g, "").toLowerCase(),
      start,
      end: semicolon + 1,
      definition: source.slice(start, semicolon + 1),
    });
  }

  return blocks;
}

function policies(source) {
  const startPattern =
    /CREATE\s+POLICY\s+("[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s+ON\s+((?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*))/gi;

  const blocks = [];

  for (const match of source.matchAll(startPattern)) {
    const start = match.index ?? 0;
    const semicolon = source.indexOf(";", start);
    assert.ok(semicolon >= 0, `Missing policy terminator: ${match[1]}`);

    blocks.push({
      name: match[1],
      table: match[2],
      start,
      end: semicolon + 1,
      definition: source.slice(start, semicolon + 1),
    });
  }

  return blocks;
}

function replaceQuotedProviderRoles(source) {
  let next = source;

  for (const [provider, canonical] of ROLE_MAP) {
    next = next.replaceAll(`"${provider}"`, `"${canonical}"`);
  }

  return next;
}

function transformPolicy(block) {
  let sql = block.definition;

  sql = sql.replace(
    /"auth"\s*\.\s*"uid"\s*\(\s*\)/gi,
    '"public"."current_profile_id"()',
  );

  if (/employee_invitations_select_authorized/i.test(block.name)) {
    const before = sql;

    sql = sql.replace(
      /"lower"\("email"\)\s*=\s*"lower"\(\s*COALESCE\(\s*\(\(\s*SELECT\s+"auth"\s*\.\s*"jwt"\s*\(\s*\)\s+AS\s+"jwt"\s*\)\s*->>\s*'email'::"text"\s*\)\s*,\s*''::"text"\s*\)\s*\)/gi,
      '( SELECT "private"."current_identity_email_matches"("employee_invitations"."email") AS "current_identity_email_matches")',
    );

    assert.notEqual(sql, before, "Employee invitation JWT policy clause was not rewritten.");
  }

  sql = replaceQuotedProviderRoles(sql);

  assert.equal(count(sql, providerAuthPattern()), 0,
    `Provider auth helper survived policy rewrite: ${block.name}`);

  assert.equal(count(sql, quotedProviderRolePattern()), 0,
    `Provider role survived policy rewrite: ${block.name}`);

  return sql;
}

function rewriteDeliveryWorker(block) {
  let sql = block.definition;

  const guardPattern =
    /\s*if\s+coalesce\(\s*\(\s*select\s+auth\.role\s*\(\s*\)\s*\)\s*,\s*''\s*\)\s*<>\s*'service_role'\s+then[\s\S]*?end\s+if;\s*/i;

  const before = sql;
  sql = sql.replace(guardPattern, "\n");

  assert.notEqual(sql, before, "Delivery-worker auth.role() guard was not removed.");
  assert.equal(count(sql, /\bauth\.role\s*\(/gi), 0);

  return sql;
}

function providerGrantStatements(source) {
  return [...source.matchAll(
    /^GRANT\s+.+?\s+TO\s+"(?:authenticated|anon|service_role)"(?:\s+WITH\s+GRANT\s+OPTION)?;$/gmi,
  )].map((match) => match[0]);
}

function revokeForGrant(grant) {
  const match =
    /^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+"(authenticated|anon|service_role)"(?:\s+WITH\s+GRANT\s+OPTION)?;$/i.exec(grant.trim());

  assert.ok(match, `Unable to convert provider grant into revoke: ${grant}`);

  return `REVOKE ${match[1]} ON ${match[2]} FROM "${match[3]}";`;
}

const original = await readFile(BASELINE, "utf8");
const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));

if (manifest.r4RoleSecurityNormalization?.status === "COMPLETE") {
  assert.equal(count(original, providerAuthPattern()), 0);
  assert.equal(count(original, quotedProviderRolePattern()), 0);
  console.log("R4 role/RLS/security normalization is already complete.");
  process.exit(0);
}

assert.equal(sha256(original), R3_SHA,
  "R4 must start from the certified R3 baseline.");
assert.equal(manifest.baselineSha256, R3_SHA,
  "R3 manifest hash mismatch.");

const sourcePolicies = policies(original);
assert.equal(sourcePolicies.length, EXPECTED_POLICIES,
  "Unexpected policy count.");

const authenticatedPolicies = sourcePolicies.filter((policy) =>
  /\bTO\s+"authenticated"/i.test(policy.definition),
);
assert.equal(authenticatedPolicies.length, EXPECTED_AUTHENTICATED_POLICIES,
  "Unexpected authenticated policy count.");

const coupledPolicies = sourcePolicies.filter((policy) =>
  providerAuthPattern().test(policy.definition),
);
assert.equal(coupledPolicies.length, EXPECTED_PROVIDER_COUPLED_POLICIES,
  "Unexpected provider-coupled policy count.");

const grants = providerGrantStatements(original);
assert.equal(grants.length, EXPECTED_PROVIDER_GRANTS,
  "Unexpected provider ACL grant count.");

const sourceQuotedRoles = count(original, quotedProviderRolePattern());
assert.equal(sourceQuotedRoles, EXPECTED_QUOTED_PROVIDER_ROLES,
  "Unexpected provider-role identifier count.");

const sourceFunctions = functions(original);
const deliveryWorkers = sourceFunctions.filter((fn) =>
  fn.name === "public.update_receipt_delivery_status",
);

assert.equal(deliveryWorkers.length, 1,
  "Expected exactly one receipt-delivery status function.");
assert.equal(count(deliveryWorkers[0].definition, /\bauth\.role\s*\(/gi), 1,
  "Expected exactly one auth.role() dependency.");

const edits = [];

for (const policy of sourcePolicies) {
  const replacement = transformPolicy(policy);

  if (replacement !== policy.definition) {
    edits.push({
      start: policy.start,
      end: policy.end,
      replacement,
    });
  }
}

assert.equal(edits.length, EXPECTED_AUTHENTICATED_POLICIES,
  "R4 expected all 141 authenticated-targeted policies to change.");

const deliveryReplacement = rewriteDeliveryWorker(deliveryWorkers[0]);

edits.push({
  start: deliveryWorkers[0].start,
  end: deliveryWorkers[0].end,
  replacement: deliveryReplacement,
});

edits.sort((a, b) => b.start - a.start);

let next = original;

for (const edit of edits) {
  next = next.slice(0, edit.start) + edit.replacement + next.slice(edit.end);
}

next = replaceQuotedProviderRoles(next);

const privateSchemaMarker = "revoke all on schema private from public;";
const privateSchemaIndex = next.indexOf(privateSchemaMarker);
assert.ok(privateSchemaIndex >= 0,
  "Unable to locate canonical private-schema bootstrap marker.");

const roleInsert = privateSchemaIndex + privateSchemaMarker.length;
next = next.slice(0, roleInsert) + canonicalRoleBootstrap() + next.slice(roleInsert);

const emailMarker =
  "revoke execute on function private.current_identity_email() from public;";
const emailMarkerIndex = next.indexOf(emailMarker);
assert.ok(emailMarkerIndex >= 0,
  "Unable to locate current_identity_email() baseline marker.");

const emailInsert = emailMarkerIndex + emailMarker.length;
next =
  next.slice(0, emailInsert) +
  "\n\n" + identityEmailMatchHelper() + "\n" +
  next.slice(emailInsert);

assert.equal(count(next, providerAuthPattern()), 0,
  "Canonical baseline still contains provider auth helpers.");
assert.equal(count(next, quotedProviderRolePattern()), 0,
  "Canonical baseline still contains provider role SQL identifiers.");
assert.equal(count(next, /CREATE\s+POLICY\s+/gi), EXPECTED_POLICIES,
  "Canonical policy count changed unexpectedly.");
assert.equal(policies(next).filter((policy) =>
  /\bTO\s+"tindio_authenticated"/i.test(policy.definition),
).length,
  EXPECTED_AUTHENTICATED_POLICIES,
  "Canonical authenticated policy targeting is incomplete.");
assert.equal(count(next, /\bauth\.role\s*\(/gi), 0);

assert.match(
  next,
  /GRANT\s+ALL\s+ON\s+FUNCTION\s+"public"\."update_receipt_delivery_status"[\s\S]*?TO\s+"tindio_service";/i,
);

const changedPolicies = sourcePolicies
  .map((policy) => ({
    ...policy,
    transformed: transformPolicy(policy),
  }))
  .filter((policy) => policy.transformed !== policy.definition);

const policyMigration = [];
for (const policy of changedPolicies) {
  policyMigration.push(`DROP POLICY IF EXISTS ${policy.name} ON ${policy.table};`);
  policyMigration.push(policy.transformed);
  policyMigration.push("");
}

const grantMigration = [];
for (const grant of grants) {
  grantMigration.push(revokeForGrant(grant));
  grantMigration.push(replaceQuotedProviderRoles(grant));
  grantMigration.push("");
}

const migration = [
  "begin;",
  "",
  canonicalRoleBootstrap().trim(),
  "",
  identityEmailMatchHelper({ replace: true }),
  "",
  rewriteDeliveryWorker(deliveryWorkers[0]),
  "",
  "-- Rebuild canonical RLS policies against TINDIO-owned access classes.",
  "",
  ...policyMigration,
  "-- Move explicit ACLs from provider roles to TINDIO-owned access classes.",
  "",
  ...grantMigration,
  "commit;",
  "",
].join("\n");

assert.equal(count(migration, providerAuthPattern()), 0,
  "R4 migration contains provider auth helpers.");

await mkdir(MIGRATION_DIR, { recursive: true });
await writeFile(BASELINE, next, "utf8");
await writeFile(MIGRATION, migration, "utf8");

manifest.baselineSha256 = sha256(next);
manifest.baselineBytes = Buffer.byteLength(next, "utf8");
manifest.baselineLines = next.split("\n").length;

manifest.baselinePortabilityInventory = {
  ...manifest.baselinePortabilityInventory,
  authUidReferences: 0,
  authUserIdReferences: 0,
  authJwtReferences: 0,
  authRoleReferences: 0,
  authSchemaReferences: count(next, /(?:"auth"\s*\.\s*|\bauth\.)/gi),
  providerRoleReferences: count(next, quotedProviderRolePattern()),
  providerCoupledPolicies: 0,
};

manifest.r4RoleSecurityNormalization = {
  status: "COMPLETE",
  r3BaselineSha256: R3_SHA,
  totalPolicies: sourcePolicies.length,
  authenticatedPoliciesRewritten: authenticatedPolicies.length,
  providerCoupledPoliciesRewritten: coupledPolicies.length,
  sourceProviderGrantStatements: grants.length,
  sourceQuotedProviderRoleIdentifiers: sourceQuotedRoles,
  baselineProviderRoleIdentifiersAfter: 0,
  baselineProviderAuthReferencesAfter: 0,
  baselineAuthRoleReferencesAfter: 0,
  canonicalRoles: [
    "tindio_anon",
    "tindio_authenticated",
    "tindio_service",
  ],
  canonicalMigration: "database/migrations/0003_provider_neutral_roles_rls.sql",
  providerRoleAdapters: [
    "database/provider/local/00_roles.sql",
    "database/provider/neon/00_roles.sql",
  ],
};

await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log("TINDIO R4 ROLE / RLS / SECURITY NORMALIZATION: PASS");
console.log(JSON.stringify({
  policies: sourcePolicies.length,
  policiesRetargeted: authenticatedPolicies.length,
  providerCoupledPoliciesRewritten: coupledPolicies.length,
  providerGrantsMoved: grants.length,
  sourceProviderRoleIdentifiers: sourceQuotedRoles,
  providerRoleIdentifiersAfter: 0,
  providerAuthReferencesAfter: 0,
  newBaselineSha256: manifest.baselineSha256,
}, null, 2));
