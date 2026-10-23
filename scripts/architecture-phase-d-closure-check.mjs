import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => readFile(path.join(root, file), "utf8");
const inventory = JSON.parse(await read("docs/architecture/TINDIO_PHASE_D_ROUTE_INVENTORY.json"));
const routes = inventory.boundaries.flatMap((boundary) => boundary.routes.map((route) => ({ ...route, boundary, mode: route.mode ?? boundary.mode })));

async function filesBelow(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"));
}
const routeKey = ({ method, path: routePath }) => `${method} ${routePath}`;
const webFile = (routePath) => `src/app${routePath}/route.ts`;
const backendFile = (routePath) => `apps/backend${routePath}.ts`;
const methods = (source) => [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((match) => match[1]).sort();

test("D50 freezes exactly 43 unique POS v2 routes under explicit ownership boundaries", () => {
  assert.equal(inventory.slice, "D50");
  assert.equal(inventory.status, "certified");
  assert.equal(routes.length, inventory.expectedRouteCount);
  assert.equal(new Set(routes.map(routeKey)).size, inventory.expectedRouteCount);
  assert.equal(inventory.boundaries.length, 29);
});

test("every Web POS v2 rollback route has one exact Backend counterpart", async () => {
  const expectedWeb = routes.map(({ path: routePath }) => webFile(routePath)).sort();
  const expectedBackend = routes.map(({ path: routePath }) => backendFile(routePath)).sort();
  const actualWeb = (await filesBelow("src/app/api/pos/v2")).filter((file) => file.endsWith("/route.ts")).sort();
  const actualBackend = (await filesBelow("apps/backend/api/pos/v2")).filter((file) => file.endsWith(".ts")).sort();
  assert.deepEqual(actualWeb, expectedWeb);
  assert.deepEqual(actualBackend, expectedBackend);
});

test("Web rollback and Backend owner expose the same single HTTP method", async () => {
  for (const route of routes) {
    assert.deepEqual(methods(await read(webFile(route.path))), [route.method], `Web method drift: ${routeKey(route)}`);
    assert.deepEqual(methods(await read(backendFile(route.path))), [route.method], `Backend method drift: ${routeKey(route)}`);
  }
});

test("every Backend route selects an owned-by-default mode and explicit Web rollback origin", async () => {
  const environment = await read("apps/backend/.env.example");
  const expectedModes = new Set(inventory.boundaries.flatMap((boundary) => [boundary.mode, ...(boundary.additionalModes ?? [])]));
  const actualModes = new Set([...environment.matchAll(/^(TINDIO_[A-Z0-9_]+_MODE)=owned$/gm)].map((match) => match[1]));
  assert.deepEqual([...actualModes].sort(), [...expectedModes].sort());
  for (const route of routes) {
    const source = await read(backendFile(route.path));
    assert.ok(source.includes(`process.env.${route.mode}`), `missing mode: ${routeKey(route)}`);
    assert.match(source, /process\.env\.TINDIO_WEB_API_ORIGIN/, `missing rollback origin: ${routeKey(route)}`);
  }
});

test("all 29 services default to owned and all rollback proxies fail closed", async () => {
  for (const boundary of inventory.boundaries) {
    const service = await read(`apps/backend/src/pos/${boundary.name}-service.ts`);
    const proxy = await read(`apps/backend/src/pos/${boundary.name}-proxy.ts`);
    assert.match(service, /\?\?\s*["']owned["']/, `${boundary.name} must default owned`);
    assert.match(service, /mode\s*===\s*["']proxy["']/, `${boundary.name} must retain explicit rollback`);
    assert.match(proxy, /method/, `${boundary.name} proxy must be method-aware`);
    assert.doesNotMatch(proxy, /pathname\.startsWith|headers\s*:\s*request\.headers|["']cookie["']|["']x-tindio-device-secret["']/, `${boundary.name} proxy is too broad`);
  }
});

test("every ownership boundary retains a focused executable architecture gate", async () => {
  const scripts = JSON.parse(await read("package.json")).scripts;
  for (const boundary of inventory.boundaries) {
    const command = scripts[boundary.ownershipTest];
    assert.equal(typeof command, "string", `missing ${boundary.ownershipTest}`);
    assert.match(command, /architecture-backend-.+-(?:ownership|compatibility)-check\.mjs/);
  }
  assert.match(scripts["test:architecture-phase-d-closure"], /architecture-phase-d-closure-check\.mjs/);
});

test("Phase D closes without schema, deployment, Auth, or client-origin cutover", async () => {
  assert.match(await read("docs/architecture/TINDIO_MIGRATION_SEQUENCE.md"), /PHASE D COMPLETE; 43 ROUTES BACKEND-OWNED/);
  assert.match(await read("docs/architecture/TINDIO_ARCHITECTURE_CERTIFICATION.md"), /SLICE D50 COMPLETE; PHASE D CLOSURE CERTIFIED/);
  assert.match(await read("apps/backend/README.md"), /Slice D50 Phase D closure/);
});
