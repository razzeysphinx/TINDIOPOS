import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const baseline = readFileSync(
  "database/baseline/0001_tindio_baseline.sql",
  "utf8",
);

const localRoles = readFileSync(
  "database/provider/local/00_roles.sql",
  "utf8",
);

const neonRoles = readFileSync(
  "database/provider/neon/00_roles.sql",
  "utf8",
);

const manifest = JSON.parse(
  readFileSync(
    "database/baseline/0001_tindio_baseline.manifest.json",
    "utf8",
  ),
);

const n = (source, pattern) =>
  (source.match(pattern) ?? []).length;

const providerAuth =
  /(?:"auth"\s*\.\s*"(?:uid|user_id|jwt|role)"|\bauth\.(?:uid|user_id|jwt|role))\s*\(/gi;

const providerRoles =
  /"(?:authenticated|anon|service_role)"/gi;

function policies(source) {
  const startPattern =
    /CREATE\s+POLICY\s+("[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s+ON\s+((?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*))/gi;

  return [...source.matchAll(startPattern)].map((match) => {
    const start = match.index ?? 0;
    const semicolon = source.indexOf(";", start);
    assert.ok(semicolon >= 0, `Missing policy terminator: ${match[1]}`);
    return source.slice(start, semicolon + 1);
  });
}

test("canonical baseline contains only TINDIO-owned access classes", () => {
  assert.equal(n(baseline, providerRoles), 0);

  for (const role of [
    "tindio_anon",
    "tindio_authenticated",
    "tindio_service",
  ]) {
    assert.match(
      baseline,
      new RegExp(`rolname = '${role}'`, "i"),
    );
  }
});

test("canonical baseline contains no provider auth helper", () => {
  assert.equal(n(baseline, providerAuth), 0);
});

test("all authenticated RLS policies target tindio_authenticated", () => {
  assert.equal(n(baseline, /CREATE\s+POLICY\s+/gi), 149);
  assert.equal(policies(baseline).filter((policy) =>
    /\bTO\s+"tindio_authenticated"/i.test(policy),
  ).length, 141);
  assert.equal(policies(baseline).filter((policy) =>
    /\bTO\s+"authenticated"/i.test(policy),
  ).length, 0);
});

test("receipt-delivery worker is protected by role grants instead of auth.role", () => {
  assert.equal(n(baseline, /\bauth\.role\s*\(/gi), 0);

  assert.match(
    baseline,
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+"public"\."update_receipt_delivery_status"[\s\S]*?FROM\s+PUBLIC;/i,
  );

  assert.match(
    baseline,
    /GRANT\s+ALL\s+ON\s+FUNCTION\s+"public"\."update_receipt_delivery_status"[\s\S]*?TO\s+"tindio_service";/i,
  );
});

test("invitation policy preserves email semantics without JWT coupling", () => {
  assert.match(baseline, /current_identity_email_matches/i);
  assert.doesNotMatch(baseline, /"auth"\s*\.\s*"jwt"\s*\(/i);
});

test("provider role adapters map runtime roles into canonical roles", () => {
  assert.match(localRoles, /grant tindio_authenticated[\s\S]*to authenticated/i);
  assert.match(localRoles, /grant tindio_anon[\s\S]*to anon/i);
  assert.match(localRoles, /grant tindio_service[\s\S]*to service_role/i);

  assert.match(neonRoles, /grant tindio_authenticated[\s\S]*to authenticated/i);
  assert.match(neonRoles, /grant tindio_anon[\s\S]*to anon/i);
  assert.match(neonRoles, /grant tindio_service[\s\S]*to service_role/i);
});

test("R4 manifest records complete normalization", () => {
  const r4 = manifest.r4RoleSecurityNormalization;

  assert.equal(r4.status, "COMPLETE");
  assert.equal(r4.totalPolicies, 149);
  assert.equal(r4.authenticatedPoliciesRewritten, 141);
  assert.equal(r4.providerCoupledPoliciesRewritten, 11);
  assert.equal(r4.sourceProviderGrantStatements, 532);
  assert.equal(r4.sourceQuotedProviderRoleIdentifiers, 682);
  assert.equal(r4.baselineProviderRoleIdentifiersAfter, 0);
  assert.equal(r4.baselineProviderAuthReferencesAfter, 0);
});
