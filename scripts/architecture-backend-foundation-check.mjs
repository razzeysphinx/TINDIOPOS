import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("backend is an independently operated workspace", async () => {
  const [backendManifestSource, rootManifestSource, workspace] = await Promise.all([
    read("apps/backend/package.json"),
    read("package.json"),
    read("pnpm-workspace.yaml"),
  ]);
  const backendManifest = JSON.parse(backendManifestSource);
  const rootManifest = JSON.parse(rootManifestSource);

  assert.equal(backendManifest.name, "@tindio/backend");
  assert.equal(backendManifest.private, true);
  assert.deepEqual(Object.keys(backendManifest.dependencies ?? {}), []);
  assert.equal(backendManifest.scripts.typecheck, "tsc -p tsconfig.json --noEmit");
  assert.equal(backendManifest.scripts.build, "tsc -p tsconfig.build.json");
  assert.match(backendManifest.scripts.test, /node --test test\/health\.test\.mjs/);
  assert.equal(rootManifest.scripts["backend:typecheck"], "pnpm --dir apps/backend typecheck");
  assert.equal(rootManifest.scripts["backend:build"], "pnpm --dir apps/backend build");
  assert.equal(rootManifest.scripts["backend:test"], "pnpm --dir apps/backend test");
  assert.match(rootManifest.scripts["workspace:typecheck"], /backend:typecheck/);
  assert.match(workspace, /apps\/\*/);
});

test("health function uses a provider-neutral Web response", async () => {
  const [route, health] = await Promise.all([
    read("apps/backend/api/health.ts"),
    read("apps/backend/src/health.ts"),
  ]);
  const source = `${route}\n${health}`;

  assert.match(route, /export function GET\(\): Response/);
  assert.match(health, /service:\s*["']tindio-backend["']/);
  assert.match(health, /status:\s*["']ok["']/);
  assert.match(health, /["']cache-control["']:\s*["']no-store["']/);
  assert.doesNotMatch(
    source,
    /next(?:\/|["'])|react-native|@supabase|@neon|DATABASE_URL|process\.env|runtime\s*=\s*["']edge["']/,
  );
});

test("foundation does not import Web source or introduce business endpoints", async () => {
  const [route, health, readme] = await Promise.all([
    read("apps/backend/api/health.ts"),
    read("apps/backend/src/health.ts"),
    read("apps/backend/README.md"),
  ]);
  const source = `${route}\n${health}`;

  assert.doesNotMatch(source, /(?:\.\.\/){2,}src\/|@\/|checkout|sync-push|bootstrap|mutation/);
  assert.match(readme, /No POS endpoint, mutation, authentication provider, database driver, secret,/);
  assert.match(readme, /existing Next\.js POS routes remain authoritative/);
});
