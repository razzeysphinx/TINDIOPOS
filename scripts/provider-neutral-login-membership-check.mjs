import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const actionsSource = await readFile(new URL("../src/features/auth/actions.ts", import.meta.url), "utf8");
const signInStart = actionsSource.indexOf("export async function signInAction");
const signInEnd = actionsSource.indexOf("\nexport async function signInFormAction", signInStart);

assert.notEqual(signInStart, -1, "signInAction must exist");
assert.notEqual(signInEnd, -1, "signInAction must end before signInFormAction");

const signInActionSource = actionsSource.slice(signInStart, signInEnd);
const membershipStart = signInActionSource.indexOf("const { data: membership, error: membershipError }");
const membershipEnd = signInActionSource.indexOf("\n  if (membershipError)", membershipStart);

assert.notEqual(membershipStart, -1, "signInAction must load employee membership");
assert.notEqual(membershipEnd, -1, "membership lookup must precede membership error handling");

const membershipLookupSource = signInActionSource.slice(membershipStart, membershipEnd);

test("login membership authorization uses the stable TINDIO profile identity", () => {
  assert.match(signInActionSource, /ensureCurrentIdentityProfile\s*\(/);
  assert.match(signInActionSource, /supabase\.auth\.signInWithPassword\s*\(/);
  assert.match(signInActionSource, /data\.user\.email/);
  assert.match(membershipLookupSource, /\.from\(\s*"employees"\s*\)/);
  assert.match(membershipLookupSource, /\.eq\(\s*"profile_id"\s*,\s*provisioning\.profileId\s*\)/);
  assert.doesNotMatch(membershipLookupSource, /\.eq\(\s*"profile_id"\s*,\s*data\.user\.id\s*\)/);
});
