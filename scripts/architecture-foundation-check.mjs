import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("workspace discovers application and shared package boundaries", async () => {
  const workspace = await read("pnpm-workspace.yaml");

  assert.match(workspace, /apps\/\*/);
  assert.match(workspace, /packages\/\*/);
});

test("contracts package is independently typecheckable and platform-neutral", async () => {
  const [manifestSource, contract] = await Promise.all([
    read("packages/contracts/package.json"),
    read("packages/contracts/src/index.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.name, "@tindio/contracts");
  assert.equal(manifest.private, true);
  assert.equal(manifest.scripts.typecheck, "tsc --noEmit");
  assert.match(contract, /TINDIO_POS_API_VERSION\s*=\s*["']v2["']/);
  assert.doesNotMatch(
    contract,
    /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/,
  );
});

test("Web compatibility facade and build scripts preserve the current runtime", async () => {
  const [rootManifestSource, nextConfig, facade] = await Promise.all([
    read("package.json"),
    read("next.config.ts"),
    read("src/contracts/pos.ts"),
  ]);
  const manifest = JSON.parse(rootManifestSource);

  assert.equal(manifest.name, "@tindio/web");
  assert.equal(manifest.dependencies["@tindio/contracts"], "workspace:*");
  assert.equal(manifest.scripts["web:build"], "next build");
  assert.equal(manifest.scripts["contracts:typecheck"], "pnpm --dir packages/contracts typecheck");
  assert.match(nextConfig, /transpilePackages:\s*\["@tindio\/contracts"\]/);
  assert.match(facade, /from "@tindio\/contracts"/);
});
