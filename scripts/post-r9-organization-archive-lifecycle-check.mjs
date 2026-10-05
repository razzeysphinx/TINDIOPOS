import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

async function source(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("the operational organization selector excludes lifecycle-paused tenants", async () => {
  const dal = await source("src/lib/auth/dal.ts");

  assert.match(
    dal,
    /const availableOrganizations = memberOrganizations\.filter\(\s*\(organization\) => organization\.status === "active",\s*\);/s,
  );
  assert.match(
    dal,
    /requestedOrganization\s*\?\?\s*availableOrganizations\[0\]\s*[\s\S]*?\?\?\s*memberOrganizations\[0\]/,
  );
});

test("the server action rejects suspended and archived tenant selections before writing the cookie", async () => {
  const service = await source("src/features/organization-readiness/service.ts");
  const lifecycleLookup = service.indexOf('.eq("status", "active")');
  const cookieWrite = service.indexOf('cookieStore.set("tindio-active-organization"');

  assert.ok(lifecycleLookup >= 0, "selection checks the organization lifecycle state");
  assert.ok(cookieWrite > lifecycleLookup, "the cookie is written only after active-state validation");
});
