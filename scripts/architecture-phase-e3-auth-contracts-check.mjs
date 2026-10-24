import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AuthProviderSelectionError,
  TINDIO_AUTH_PROVIDERS,
  TINDIO_DEFAULT_AUTH_PROVIDER,
  resolveTindioAuthProvider,
} from "../packages/contracts/src/auth.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const matrix = JSON.parse(await read("docs/architecture/TINDIO_PHASE_E_AUTH_PROOF_MATRIX.json"));

test("E3 owns the complete provider-neutral Auth vocabulary", async () => {
  assert.deepEqual(TINDIO_AUTH_PROVIDERS, ["supabase", "neon"]);
  assert.equal(TINDIO_DEFAULT_AUTH_PROVIDER, "supabase");
  const source = await read("packages/contracts/src/auth.ts");
  for (const marker of [
    "AuthIdentity",
    "AuthSession",
    "AuthCredentials",
    "AuthResult",
    "AuthSessionAdapter",
    "AuthVerifiedClaims",
    "AuthTokenVerifier",
  ]) assert.match(source, new RegExp(`type ${marker}`));
});

test("E3 provider selection defaults to Supabase and fails closed", () => {
  assert.equal(resolveTindioAuthProvider(undefined), "supabase");
  assert.equal(resolveTindioAuthProvider("supabase", ["supabase"]), "supabase");
  assert.throws(
    () => resolveTindioAuthProvider("neon", ["supabase"]),
    (error) => error instanceof AuthProviderSelectionError
      && error.code === "AUTH_PROVIDER_NOT_ENABLED",
  );
  assert.throws(
    () => resolveTindioAuthProvider("unexpected", ["supabase"]),
    AuthProviderSelectionError,
  );
});

test("E3 Web clients retain the Supabase default after the guarded E4 extension", async () => {
  const [provider, server, browser] = await Promise.all([
    read("src/lib/auth/provider.ts"),
    read("src/lib/supabase/server.ts"),
    read("src/lib/supabase/client.ts"),
  ]);
  assert.match(provider, /neonProofEnabled \? \["supabase", "neon"\] : \["supabase"\]/);
  assert.match(server, /process\.env\.TINDIO_AUTH_PROVIDER/);
  assert.match(browser, /process\.env\.NEXT_PUBLIC_TINDIO_AUTH_PROVIDER/);
});

test("E3 Backend reads retain the normalized adapter after the guarded E5 extension", async () => {
  const [provider, runtime] = await Promise.all([
    read("apps/backend/src/auth/provider.ts"),
    read("apps/backend/src/pos/pos-read-runtime.ts"),
  ]);
  assert.match(provider, /createBackendAuthTokenVerifier/);
  assert.match(provider, /client\.auth\.getClaims\(token\)/);
  assert.match(provider, /neonProofEnabled\(environment\)/);
  assert.match(provider, /\? \["supabase", "neon"\]/);
  assert.match(provider, /: \["supabase"\]/);
  assert.match(runtime, /authVerifier\.verifyAccessToken\(token\)/);
  assert.doesNotMatch(runtime, /authClient\.auth\.getClaims/);
});

test("E3 Mobile session and API token paths use the adapter", async () => {
  const [adapter, session, api, supabase] = await Promise.all([
    read("apps/mobile/src/features/session/auth-provider.ts"),
    read("apps/mobile/src/features/session/session-provider.tsx"),
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("apps/mobile/src/lib/supabase.ts"),
  ]);
  assert.match(adapter, /AuthSessionAdapter/);
  assert.match(adapter, /resolveTindioAuthProvider/);
  assert.match(session, /mobileAuth\.onAuthStateChange/);
  assert.match(session, /mobileAuth\.signInWithPassword/);
  assert.match(api, /mobileAuth\.refreshSession/);
  assert.match(api, /result\.value\.accessToken/);
  assert.match(supabase, /storage:\s*secureStorage/);
});

test("E3 changes no endpoint and promotes no proof flow", async () => {
  const sources = await Promise.all([
    read("packages/contracts/src/auth.ts"),
    read("src/lib/auth/provider.ts"),
    read("apps/backend/src/auth/provider.ts"),
    read("apps/mobile/src/features/session/auth-provider.ts"),
  ]);
  assert.doesNotMatch(sources.join("\n"), /neonauth\.|apirest\.|billowing-night|br-spring-shape/);
  assert.equal(matrix.requiredFlowCount, 13);
  assert.match(await read("docs/architecture/TINDIO_PHASE_E3_AUTH_CONTRACTS.md"), /every flow is `NOT_RUN`/);
});

test("E3 documentation and package surfaces are executable", async () => {
  const [handoff, migration, certification, packageJson, contractsPackage] = await Promise.all([
    read("docs/architecture/TINDIO_PHASE_E3_AUTH_CONTRACTS.md"),
    read("docs/architecture/TINDIO_MIGRATION_SEQUENCE.md"),
    read("docs/architecture/TINDIO_ARCHITECTURE_CERTIFICATION.md"),
    read("package.json"),
    read("packages/contracts/package.json"),
  ]);
  assert.match(handoff, /E3 COMPLETE/);
  assert.match(migration, /Completed Slice E3/);
  assert.match(certification, /Phase E Slices E1-E5/);
  assert.match(packageJson, /test:architecture-phase-e3-auth-contracts/);
  assert.match(contractsPackage, /"\.\/auth"/);
});
