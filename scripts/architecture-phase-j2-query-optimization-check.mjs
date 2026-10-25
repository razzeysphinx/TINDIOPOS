import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { estimateIdentityResolutionCalls } from "./phase-j-auth-query-coalescing.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("J2 coalesces identity resolution when user and business context are both requested", () => {
  assert.deepEqual(estimateIdentityResolutionCalls({ businessContextRequested: true, verifiedUserRequested: true }), {
    before: 2,
    after: 1,
    eliminated: 1
  });
  assert.equal(estimateIdentityResolutionCalls({ businessContextRequested: true, verifiedUserRequested: false }).eliminated, 0);
});

test("J2 starts independent session and cached identity work before awaiting both", async () => {
  const dal = await read("src/lib/auth/dal.ts");
  const context = dal.match(/export const getBusinessContext = cache\([\s\S]*?\n\);/)?.[0] ?? "";
  assert.match(context, /userPromise\s*=\s*getVerifiedUser\(\)/);
  assert.match(context, /sessionPromise\s*=\s*cookieClient\.auth[\s\S]*getSession\(\)/);
  assert.match(context, /Promise\.all\(\[[\s\S]*userPromise,[\s\S]*sessionPromise/);
  assert.doesNotMatch(context, /resolveVerifiedUser\(/);
  assert.ok(context.indexOf("!user") < context.indexOf("loadBusinessContext"));
});

test("J2 decision records preserved behavior and no production mutation", async () => {
  const decision = JSON.parse(await read("docs/architecture/TINDIO_PHASE_J2_QUERY_OPTIMIZATION.json"));
  assert.equal(decision.maxIdentityResolutionCallsEliminatedPerRender, 1);
  assert.equal(decision.authorizationBehaviorChanged, false);
  assert.equal(decision.productionChangesMade, false);
});
