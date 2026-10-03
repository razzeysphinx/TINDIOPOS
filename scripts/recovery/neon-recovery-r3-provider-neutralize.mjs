import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const BASELINE = path.join(ROOT, "database/baseline/0001_tindio_baseline.sql");
const MANIFEST = path.join(ROOT, "database/baseline/0001_tindio_baseline.manifest.json");
const MIGRATION_DIR = path.join(ROOT, "database/migrations");
const MIGRATION = path.join(MIGRATION_DIR, "0002_provider_neutral_business_identity.sql");

const R2_SHA = "c2c8183c6f02327e80e561b4b2b504887140586b0d5d03e068ae97132e18ef46";
const EXPECTED_FUNCTIONS = 132;
const EXPECTED_REFS = 167;

const hash = (value) => createHash("sha256").update(value).digest("hex");
const count = (source, pattern) => (source.match(pattern) ?? []).length;

function cleanName(raw) {
  return raw.replaceAll('"', "").replace(/\s+/g, "").toLowerCase();
}

function functions(source) {
  const start = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*))\s*\(/gi;
  const result = [];

  for (const match of source.matchAll(start)) {
    const from = match.index ?? 0;
    const rest = source.slice(from);
    const asMatch = /\bAS\s+(\$[A-Za-z0-9_]*\$)/i.exec(rest);
    assert.ok(asMatch, `Missing function body delimiter: ${match[1]}`);
    const delimiter = asMatch[1];
    const bodyStart = from + (asMatch.index ?? 0) + asMatch[0].length;
    const bodyEnd = source.indexOf(delimiter, bodyStart);
    assert.ok(bodyEnd >= 0, `Missing closing delimiter: ${match[1]}`);
    const semi = source.indexOf(";", bodyEnd + delimiter.length);
    assert.ok(semi >= 0, `Missing function semicolon: ${match[1]}`);
    result.push({ name: cleanName(match[1]), start: from, end: semi + 1, definition: source.slice(from, semi + 1) });
  }
  return result;
}

function subjectStub(orReplace = false) {
  return `${orReplace ? "CREATE OR REPLACE" : "CREATE"} FUNCTION "private"."current_identity_subject"()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  select null::text;
$function$;`;
}

function emailStub(orReplace = false) {
  return `${orReplace ? "CREATE OR REPLACE" : "CREATE"} FUNCTION "private"."current_identity_email"()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  select null::text;
$function$;`;
}

function rewriteBusiness(block) {
  let sql = block.definition.replace(/\bauth\.uid\s*\(\s*\)/gi, "private.current_profile_id()");
  if (block.name === "private.accept_employee_invitation") {
    sql = sql.replace(/\(\s*select\s+auth\.jwt\s*\(\s*\)\s*->>\s*'email'\s*\)/gi, "(select private.current_identity_email())");
  }
  if (!/\bSECURITY\s+DEFINER\b/i.test(sql)) {
    assert.match(block.name, /^public\./, "Only public invoker routines use the established public identity wrapper.");
    sql = sql.replaceAll("private.current_profile_id()", "public.current_profile_id()");
    assert.match(sql, /\bpublic\.current_profile_id\s*\(/i, `Could not preserve invoker security for ${block.name}.`);
  }
  assert.doesNotMatch(sql, /\bauth\.uid\s*\(/i);
  assert.doesNotMatch(sql, /\bauth\.jwt\s*\(/i);
  return sql;
}

const original = await readFile(BASELINE, "utf8");
const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));

if (manifest.r3ProviderNeutralIdentity?.status === "COMPLETE") {
  assert.equal(count(original, /\bauth\.uid\s*\(/gi), 0);
  assert.equal(count(original, /\bauth\.jwt\s*\(/gi), 0);
  console.log("R3 already generated and valid.");
  process.exit(0);
}

assert.equal(hash(original), R2_SHA, "R3 must start from certified R2 baseline.");
assert.equal(manifest.baselineSha256, R2_SHA);

const all = functions(original);
const coupled = all.filter((f) => /\bauth\.uid\s*\(/i.test(f.definition));
const sourceRefs = coupled.reduce((total, f) => total + count(f.definition, /\bauth\.uid\s*\(/gi), 0);
assert.equal(coupled.length, EXPECTED_FUNCTIONS);
assert.equal(sourceRefs, EXPECTED_REFS);

const subject = coupled.filter((f) => f.name === "private.current_identity_subject");
assert.equal(subject.length, 1);
const business = coupled.filter((f) => f.name !== "private.current_identity_subject");
assert.equal(business.length, 131);

const replacements = business.map((f) => ({ ...f, replacement: rewriteBusiness(f) }));
replacements.push({ ...subject[0], replacement: subjectStub(false) });
replacements.sort((a, b) => b.start - a.start);

let next = original;
for (const item of replacements) {
  next = next.slice(0, item.start) + item.replacement + next.slice(item.end);
}

const marker = "revoke all on schema private from public;";
const markerIndex = next.indexOf(marker);
assert.ok(markerIndex >= 0);
const insertAt = markerIndex + marker.length;
next = next.slice(0, insertAt) + `

${emailStub(false)}


revoke execute on function private.current_identity_email() from public;

` + next.slice(insertAt);

next = next.replace(/\n$/, "");

assert.equal(count(next, /\bauth\.uid\s*\(/gi), 0);
assert.equal(count(next, /\bauth\.user_id\s*\(/gi), 0);
assert.equal(count(next, /\bauth\.jwt\s*\(/gi), 0);
assert.equal(count(next, /\bauth\.role\s*\(/gi), 1, "R4 owns the one remaining auth.role() dependency.");

const fullDefinitions = business.map((f) => rewriteBusiness(f).replace(/^CREATE\s+FUNCTION/i, "CREATE OR REPLACE FUNCTION"));
const migration = [
  "begin;", "", subjectStub(true), "", emailStub(true), "",
  "revoke execute on function private.current_identity_subject() from public, anon, authenticated, service_role;",
  "revoke execute on function private.current_identity_email() from public, anon, authenticated, service_role;", "",
  "-- Complete winning definitions for all 131 business functions.", "",
  ...fullDefinitions.flatMap((sql) => [sql, ""]), "commit;", "",
].join("\n");

assert.equal(count(migration, /\bauth\.uid\s*\(/gi), 0);
assert.equal(count(migration, /\bauth\.jwt\s*\(/gi), 0);
assert.equal(count(migration, /CREATE\s+OR\s+REPLACE\s+FUNCTION/gi), 133);

await mkdir(MIGRATION_DIR, { recursive: true });
await writeFile(BASELINE, next, "utf8");
await writeFile(MIGRATION, migration, "utf8");

manifest.baselineSha256 = hash(next);
manifest.baselineBytes = Buffer.byteLength(next, "utf8");
manifest.baselineLines = next.split("\n").length;
manifest.baselinePortabilityInventory = {
  ...manifest.baselinePortabilityInventory,
  authUidReferences: count(next, /\bauth\.uid\s*\(/gi),
  authUserIdReferences: count(next, /\bauth\.user_id\s*\(/gi),
  authJwtReferences: count(next, /\bauth\.jwt\s*\(/gi),
  authRoleReferences: count(next, /\bauth\.role\s*\(/gi),
  authSchemaReferences: count(next, /\bauth\./gi),
};
manifest.r3ProviderNeutralIdentity = {
  status: "COMPLETE", r2BaselineSha256: R2_SHA,
  sourceDirectAuthUidFunctions: coupled.length, sourceAuthUidReferences: sourceRefs,
  businessFunctionsRewritten: business.length, baselineAuthUidReferencesAfter: 0,
  baselineAuthUserIdReferencesAfter: 0, baselineAuthJwtReferencesAfter: 0,
  baselineAuthRoleReferencesDeferredToR4: 1,
  canonicalMigration: "database/migrations/0002_provider_neutral_business_identity.sql",
  providerAdapters: ["database/provider/local/01_identity.sql", "database/provider/neon/01_identity.sql"],
};
await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log("TINDIO R3 PROVIDER-NEUTRAL SQL GENERATION: PASS");
console.log(JSON.stringify({ sourceFunctions: coupled.length, sourceReferences: sourceRefs, businessFunctionsRewritten: business.length, authUidAfter: 0, authJwtAfter: 0, authRoleDeferredToR4: 1, baselineSha256: manifest.baselineSha256 }, null, 2));
