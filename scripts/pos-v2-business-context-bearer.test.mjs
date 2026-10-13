import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const contextClient = fs.readFileSync("src/lib/supabase/context-client.ts", "utf8");
const posClient = fs.readFileSync("src/lib/supabase/pos-v2-database-client.ts", "utf8");

test("downstream POS RPCs use the request bearer identity", () => {
  assert.match(contextClient, /\^Bearer \(\[\^\\s\]\+\)\$\/i/);
  assert.match(contextClient, /createPosV2DatabaseClient\([\s\S]*match\[1\][\s\S]*\{ headers \}/);
});

test("device headers are retained but cannot replace authorization", () => {
  assert.match(posClient, /options:\s*\{[\s\S]*headers\?: Record<string, string>/);
  assert.match(posClient, /name\.toLowerCase\(\)\s*!==\s*"authorization"/);
  assert.match(posClient, /accessToken:\s*async \(\) =>\s*accessToken/);
});

test("non-request callers retain the existing server client fallback", () => {
  assert.match(contextClient, /return createClient\(\{\s*headers,\s*\}\)/);
});
