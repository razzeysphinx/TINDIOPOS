import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { GET as protectedClaimsRoute } from "../apps/backend/dist/api/auth-proof/claims.js";

const authBaseUrl = process.env.NEON_AUTH_BASE_URL?.trim();
const authJwksUrl = process.env.NEON_AUTH_JWKS_URL?.trim();
const dataApiUrl = process.env.NEON_DATA_API_URL?.trim();

assert.equal(process.env.TINDIO_AUTH_PROVIDER, "neon");
assert.equal(process.env.TINDIO_AUTH_PROOF_MODE, "local");
assert.notEqual(process.env.NODE_ENV, "production");
assert.equal(process.env.VERCEL, undefined, "E5 proof cannot run in a Vercel deployment");
assert.equal(process.env.VERCEL_ENV, undefined, "E5 proof cannot run in a Vercel deployment");
assert.ok(authBaseUrl, "NEON_AUTH_BASE_URL is required");
assert.ok(authJwksUrl, "NEON_AUTH_JWKS_URL is required");
assert.ok(dataApiUrl, "NEON_DATA_API_URL is required");

const authUrl = new URL(authBaseUrl);
const jwksUrl = new URL(authJwksUrl);
const restUrl = new URL(dataApiUrl);
const normalizedAuthPath = authUrl.pathname.replace(/\/$/, "");
const managedAuthHost =
  /^[a-z0-9-]+\.neonauth(?:\.[a-z0-9-]+)*\.neon\.tech$/i;
const managedDataHost =
  /^[a-z0-9-]+\.apirest(?:\.[a-z0-9-]+)*\.neon\.tech$/i;

assert.equal(authUrl.protocol, "https:");
assert.match(authUrl.hostname, managedAuthHost);
assert.ok(normalizedAuthPath.endsWith("/auth"));
assert.equal(jwksUrl.origin, authUrl.origin);
assert.equal(
  jwksUrl.pathname,
  `${normalizedAuthPath}/.well-known/jwks.json`,
);
assert.equal(restUrl.protocol, "https:");
assert.match(restUrl.hostname, managedDataHost);
assert.ok(restUrl.pathname.endsWith("/rest/v1"));

const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const email = `phase-e5-${runId}@auth-proof.tindio.invalid`;
const password = `E5!aA9-${randomBytes(18).toString("base64url")}`;
const localOrigin = "http://localhost:3104";

const signupResponse = await fetch(`${authUrl.origin}${normalizedAuthPath}/sign-up/email`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: localOrigin,
  },
  body: JSON.stringify({
    email,
    name: "TINDIO Phase E5 Synthetic User",
    password,
  }),
});
const signupBody = await signupResponse.json();
assert.equal(signupResponse.status, 200, "synthetic Neon signup must succeed");
assert.equal(signupBody.user?.email, email);
assert.equal(typeof signupBody.user?.id, "string");

const sessionCookie = (signupResponse.headers.get("set-cookie") ?? "")
  .split(";", 1)[0];
assert.ok(sessionCookie.includes("="), "signup must return a session cookie");

const tokenResponse = await fetch(`${authUrl.origin}${normalizedAuthPath}/token`, {
  headers: {
    Cookie: sessionCookie,
    Origin: localOrigin,
  },
});
const tokenBody = await tokenResponse.json();
const accessToken = tokenBody.token ?? tokenBody.access_token;
assert.equal(tokenResponse.status, 200, "session must issue an access token");
assert.equal(typeof accessToken, "string");
assert.equal(accessToken.split(".").length, 3, "access token must be a JWT");

const callProtectedRoute = (token) => protectedClaimsRoute(
  new Request("http://localhost/api/auth-proof/claims", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }),
);

const missingTokenResponse = await callProtectedRoute();
assert.equal(missingTokenResponse.status, 401);

const invalidToken = `${accessToken.slice(0, -1)}${
  accessToken.endsWith("a") ? "b" : "a"
}`;
const invalidTokenResponse = await callProtectedRoute(invalidToken);
assert.equal(invalidTokenResponse.status, 401);

const validTokenResponse = await callProtectedRoute(accessToken);
const validTokenBody = await validTokenResponse.json();
assert.equal(validTokenResponse.status, 200);
assert.equal(validTokenBody.identity.provider, "neon");
assert.equal(validTokenBody.identity.subject, signupBody.user.id);
assert.equal(validTokenBody.identity.email, email);
assert.equal(validTokenBody.identity.role, "authenticated");
assert.doesNotMatch(JSON.stringify(validTokenBody), new RegExp(accessToken));

const identityRpcUrl = new URL(restUrl);
identityRpcUrl.pathname = `${identityRpcUrl.pathname.replace(/\/$/, "")}/rpc/current_profile_id`;
const callIdentityRpc = (token) => fetch(identityRpcUrl, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: "{}",
});

const deniedDataResponse = await callIdentityRpc(invalidToken);
assert.ok(
  deniedDataResponse.status >= 400 && deniedDataResponse.status < 500,
  `invalid Data API token must be denied, received ${deniedDataResponse.status}`,
);

const allowedDataResponse = await callIdentityRpc(accessToken);
const resolvedProfileId = await allowedDataResponse.json();
assert.equal(allowedDataResponse.status, 200);
assert.equal(
  resolvedProfileId,
  null,
  "synthetic Auth identity must not resolve to merchant profile data",
);

const signOutResponse = await fetch(`${authUrl.origin}${normalizedAuthPath}/sign-out`, {
  method: "POST",
  headers: {
    Cookie: sessionCookie,
    "Content-Type": "application/json",
    Origin: localOrigin,
  },
  body: "{}",
});
assert.ok(
  signOutResponse.ok,
  `synthetic proof session cleanup must succeed, received ${signOutResponse.status}`,
);

process.stdout.write(`${JSON.stringify({
  status: "PASS",
  runId,
  syntheticEmail: email,
  authEndpointHost: authUrl.hostname,
  dataApiEndpointHost: restUrl.hostname,
  evidence: {
    missingBearerDenied: true,
    invalidSignatureDeniedByBackend: true,
    validJwtAcceptedByBackend: true,
    normalizedSubjectMatchedAuthUser: true,
    invalidSignatureDeniedByDataApi: true,
    authenticatedOnlyIdentityRpcAllowed: true,
    merchantProfileRemainedAbsent: true,
    tokenExcludedFromProofResponse: true,
    syntheticSessionSignedOut: true,
  },
  promotedFlows: ["E-AUTH-05", "E-AUTH-11"],
}, null, 2)}\n`);
