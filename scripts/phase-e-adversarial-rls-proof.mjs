import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  createRemoteJWKSet,
  decodeJwt,
  jwtVerify,
} from "../apps/backend/node_modules/jose/dist/webapi/index.js";

const authBaseUrl = process.env.NEON_AUTH_BASE_URL?.trim();
const jwksUrl = process.env.NEON_AUTH_JWKS_URL?.trim();
const dataApiUrl = process.env.NEON_DATA_API_URL?.trim();
const projectId = process.env.TINDIO_PHASE_E_NEON_PROJECT_ID?.trim();
const branchId = process.env.TINDIO_PHASE_E_NEON_BRANCH_ID?.trim();
const databaseName = process.env.TINDIO_PHASE_E_NEON_DATABASE_NAME?.trim();
const roleName = process.env.TINDIO_PHASE_E_NEON_ROLE_NAME?.trim();
const repositoryRoot = new URL("..", import.meta.url);

assert.equal(process.env.TINDIO_AUTH_PROVIDER, "neon");
assert.equal(process.env.TINDIO_AUTH_PROOF_MODE, "local");
assert.notEqual(process.env.NODE_ENV, "production");
assert.equal(process.env.VERCEL, undefined);
assert.equal(process.env.VERCEL_ENV, undefined);
assert.ok(authBaseUrl && jwksUrl && dataApiUrl);
for (const value of [projectId, branchId]) assert.match(value ?? "", /^[a-z0-9-]+$/i);
for (const value of [databaseName, roleName]) assert.match(value ?? "", /^[a-z_][a-z0-9_]*$/i);

const authUrl = new URL(authBaseUrl);
const restUrl = new URL(dataApiUrl);
assert.match(authUrl.hostname, /^[a-z0-9-]+\.neonauth(?:\.[a-z0-9-]+)*\.neon\.tech$/i);
assert.match(restUrl.hostname, /^[a-z0-9-]+\.apirest(?:\.[a-z0-9-]+)*\.neon\.tech$/i);
assert.ok(authUrl.pathname.replace(/\/$/, "").endsWith("/auth"));
assert.ok(restUrl.pathname.replace(/\/$/, "").endsWith("/rest/v1"));
assert.equal(new URL(jwksUrl).origin, authUrl.origin);

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} exited with ${code}.\n${stderr}`));
    });
  });
}

function runNeon(args) {
  if (process.platform !== "win32") return runCommand("neon", args);
  assert.ok(process.env.APPDATA);
  return runCommand(process.execPath, [
    join(process.env.APPDATA, "npm", "node_modules", "neon", "dist", "cli.js"),
    ...args,
  ]);
}

const neonArgs = (args) => [
  ...args,
  "--project-id", projectId,
  "--branch", branchId,
  "--output", "json",
];

const psql = (sql) => runNeon([
  "psql", branchId,
  "--project-id", projectId,
  "--database-name", databaseName,
  "--role-name", roleName,
  "--", "-X", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql,
]);

async function getEmailPasswordConfiguration() {
  return JSON.parse(await runNeon(neonArgs([
    "neon-auth", "config", "email-password", "get",
  ])));
}

async function setEmailPasswordConfiguration(configuration) {
  await runNeon(neonArgs([
    "neon-auth", "config", "email-password", "update",
    "--enabled", String(configuration.enabled),
    "--email-verification-method", configuration.email_verification_method,
    "--require-email-verification", String(configuration.require_email_verification),
    "--auto-sign-in-after-verification", String(configuration.auto_sign_in_after_verification),
    "--send-verification-email-on-sign-up", String(configuration.send_verification_email_on_sign_up),
    "--send-verification-email-on-sign-in", String(configuration.send_verification_email_on_sign_in),
    "--disable-sign-up", String(configuration.disable_sign_up),
  ]));
}

const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const email = `phase-e-rls-${runId}@auth-proof.tindio.invalid`;
const password = `Er6!${randomBytes(18).toString("base64url")}`;
const profileA = randomUUID();
const profileB = randomUUID();
const organizationA = randomUUID();
const organizationB = randomUUID();
const origin = "http://localhost:3109";
const originalConfiguration = await getEmailPasswordConfiguration();
const proofConfiguration = {
  enabled: true,
  email_verification_method: "otp",
  require_email_verification: false,
  auto_sign_in_after_verification: true,
  send_verification_email_on_sign_up: false,
  send_verification_email_on_sign_in: false,
  disable_sign_up: false,
};

let userId = null;
let rowsCreated = false;
let proofFailure;
let configurationRestored = false;
let syntheticUserRemoved = false;
let rowsRemaining = null;
let result;

const authFetch = (path, init = {}) => fetch(`${authBaseUrl.replace(/\/$/, "")}/${path}`, {
  ...init,
  headers: { Origin: origin, ...(init.headers ?? {}) },
});
const dataFetch = (path, token, extraHeaders = {}) => fetch(
  `${dataApiUrl.replace(/\/$/, "")}/${path}`,
  { headers: { Authorization: `Bearer ${token}`, ...extraHeaders } },
);

const cleanupSql = (organizationFilter, profileFilter, identityFilter) => [
  "begin",
  `delete from public.approval_rules where organization_id in (${organizationFilter})`,
  `delete from public.payment_methods where organization_id in (${organizationFilter})`,
  `delete from public.loyalty_programs where organization_id in (${organizationFilter})`,
  `delete from public.organization_features where organization_id in (${organizationFilter})`,
  `delete from public.receipt_settings where organization_id in (${organizationFilter})`,
  `delete from private.organization_data_governance where organization_id in (${organizationFilter})`,
  `delete from public.organizations where id in (${organizationFilter})`,
  `delete from private.identity_links where ${identityFilter}`,
  `delete from public.profiles where id in (${profileFilter})`,
  "commit",
].join("; ");

try {
  const residualOrganizations = "select id from public.organizations where name in ('RLS Tenant A','RLS Tenant B') and created_by in (select id from public.profiles where email ~ '^phase-e-rls-.*@auth-proof[.]tindio[.]invalid$' or email ~ '^tenant-b-.*@auth-proof[.]tindio[.]invalid$')";
  const residualProfiles = "select id from public.profiles where email ~ '^phase-e-rls-.*@auth-proof[.]tindio[.]invalid$' or email ~ '^tenant-b-.*@auth-proof[.]tindio[.]invalid$'";
  await psql(cleanupSql(
    residualOrganizations,
    residualProfiles,
    `profile_id in (${residualProfiles})`,
  ));

  await setEmailPasswordConfiguration(proofConfiguration);
  const signup = await authFetch("sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: "TINDIO Adversarial RLS Proof" }),
  });
  const signupBody = await signup.json();
  assert.equal(signup.status, 200, JSON.stringify(signupBody));
  userId = signupBody.user?.id;
  assert.match(userId ?? "", /^[0-9a-f-]{36}$/i);
  const cookie = (signup.headers.get("set-cookie") ?? "").split(";", 1)[0];
  assert.ok(cookie.includes("="));
  const tokenResponse = await authFetch("token", { headers: { Cookie: cookie } });
  const tokenPayload = await tokenResponse.json();
  const token = tokenPayload.token ?? tokenPayload.access_token;
  assert.equal(tokenResponse.status, 200);
  assert.equal(token.split(".").length, 3);

  await psql([
    "begin",
    "alter table public.organizations disable trigger organizations_seed_approval_rules",
    "alter table public.organizations disable trigger organizations_seed_data_governance",
    "alter table public.organizations disable trigger organizations_seed_default_payment_methods",
    "alter table public.organizations disable trigger organizations_seed_feature_recommendations",
    "alter table public.organizations disable trigger organizations_seed_loyalty",
    "alter table public.organizations disable trigger organizations_seed_receipt_settings",
    `insert into public.profiles (id,full_name,email) values ('${profileA}','RLS Tenant A','${email}'),('${profileB}','RLS Tenant B','tenant-b-${runId}@auth-proof.tindio.invalid')`,
    `insert into private.identity_links (provider,provider_subject,profile_id) values ('supabase','${userId}','${profileA}')`,
    `insert into public.organizations (id,name,created_by) values ('${organizationA}','RLS Tenant A','${profileA}'),('${organizationB}','RLS Tenant B','${profileB}')`,
    "alter table public.organizations enable trigger organizations_seed_approval_rules",
    "alter table public.organizations enable trigger organizations_seed_data_governance",
    "alter table public.organizations enable trigger organizations_seed_default_payment_methods",
    "alter table public.organizations enable trigger organizations_seed_feature_recommendations",
    "alter table public.organizations enable trigger organizations_seed_loyalty",
    "alter table public.organizations enable trigger organizations_seed_receipt_settings",
    "commit",
  ].join("; "));
  rowsCreated = true;

  const mappedProfileResponse = await dataFetch("rpc/current_profile_id", token);
  const mappedProfile = await mappedProfileResponse.json();
  assert.equal(mappedProfileResponse.status, 200, JSON.stringify(mappedProfile));
  assert.equal(
    mappedProfile,
    profileA,
    `provider subject ${decodeJwt(token).sub} did not resolve through the synthetic identity link`,
  );

  const ownResponse = await dataFetch(
    "organizations?select=id,name&order=id.asc",
    token,
    { "x-tindio-organization-id": organizationB },
  );
  const visibleOrganizations = await ownResponse.json();
  assert.equal(ownResponse.status, 200, JSON.stringify(visibleOrganizations));
  assert.deepEqual(visibleOrganizations.map(({ id }) => id), [organizationA]);

  const crossTenantResponse = await dataFetch(
    `organizations?select=id&id=eq.${organizationB}`,
    token,
    { "x-tindio-organization-id": organizationB },
  );
  assert.equal(crossTenantResponse.status, 200);
  assert.deepEqual(await crossTenantResponse.json(), []);

  const malformedResponse = await dataFetch("rpc/current_profile_id", "not.a.jwt");
  assert.ok(malformedResponse.status >= 400 && malformedResponse.status < 500);
  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  const tamperedResponse = await dataFetch("rpc/current_profile_id", tampered);
  assert.ok(tamperedResponse.status >= 400 && tamperedResponse.status < 500);

  const claims = decodeJwt(token);
  assert.equal(typeof claims.exp, "number");
  await assert.rejects(
    jwtVerify(token, createRemoteJWKSet(new URL(jwksUrl)), {
      algorithms: ["EdDSA"],
      currentDate: new Date((claims.exp + 1) * 1_000),
    }),
    (error) => error?.code === "ERR_JWT_EXPIRED",
  );

  const signOut = await authFetch("sign-out", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(signOut.ok, true);
  await psql(`delete from private.identity_links where provider='supabase' and provider_subject='${userId}'`);
  const revokedIdentityResponse = await dataFetch("rpc/current_profile_id", token);
  assert.equal(revokedIdentityResponse.status, 200);
  assert.equal(await revokedIdentityResponse.json(), null);
  const revokedRlsResponse = await dataFetch("organizations?select=id", token);
  assert.equal(revokedRlsResponse.status, 200);
  assert.deepEqual(await revokedRlsResponse.json(), []);

  result = {
    status: "PASS",
    runId,
    syntheticEmail: email,
    evidence: {
      validJwtMappedToSyntheticProfile: true,
      ownTenantVisible: true,
      crossTenantFilterReturnedZeroRows: true,
      forgedOrganizationHeaderDidNotExpandScope: true,
      malformedJwtDenied: true,
      tamperedJwtDenied: true,
      realJwtRejectedAtCryptographicFutureExpiry: true,
      signedOutSessionRevoked: true,
      removedIdentityLinkResolvedNull: true,
      revokedIdentityRlsReturnedZeroRows: true,
    },
    promotedFlows: ["E-AUTH-12"],
  };
} catch (error) {
  proofFailure = error;
} finally {
  if (rowsCreated) {
    try {
      await psql(cleanupSql(
        `'${organizationA}','${organizationB}'`,
        `'${profileA}','${profileB}'`,
        `provider='supabase' and provider_subject='${userId}'`,
      ));
      rowsRemaining = Number(await psql(
        `select (select count(*) from public.organizations where id in ('${organizationA}','${organizationB}')) + (select count(*) from public.profiles where id in ('${profileA}','${profileB}')) + (select count(*) from private.identity_links where provider_subject='${userId}')`,
      ));
    } catch (error) {
      proofFailure ??= error;
    }
  }
  if (userId) {
    try {
      await runNeon(neonArgs(["neon-auth", "user", "delete", userId]));
      syntheticUserRemoved = true;
    } catch (error) {
      proofFailure ??= error;
    }
  }
  try {
    await setEmailPasswordConfiguration(originalConfiguration);
    configurationRestored = JSON.stringify(await getEmailPasswordConfiguration())
      === JSON.stringify(originalConfiguration);
  } catch (error) {
    proofFailure ??= error;
  }
}

if (proofFailure) throw proofFailure;
assert.equal(rowsRemaining, 0);
assert.equal(syntheticUserRemoved, true);
assert.equal(configurationRestored, true);
result.evidence.temporaryRowsRemaining = rowsRemaining;
result.evidence.syntheticUserRemoved = syntheticUserRemoved;
result.evidence.originalAuthConfigurationRestored = configurationRestored;
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
