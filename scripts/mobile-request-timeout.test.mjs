import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => fs.readFileSync(path, "utf8");

async function loadTypeScriptModule(file) {
  const output = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const transport = await loadTypeScriptModule("apps/mobile/src/lib/request-timeout.ts");
const apiSource = read("apps/mobile/src/lib/tindio-api.ts");

const abortingFetch = (_input, init) => new Promise((_resolve, reject) => {
  init.signal.addEventListener("abort", () => reject(new Error("ABORTED")), { once: true });
});

test("MOB-09 shared API transport aborts a stalled request at its deadline", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    transport.fetchWithTimeout(abortingFetch, "https://example.invalid", {}, 20),
    (error) => error instanceof transport.PosApiRequestTimeoutError,
  );
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed >= 10 && elapsed < 1_000, `unexpected timeout duration: ${elapsed}ms`);
});

test("MOB-09 caller cancellation remains distinguishable from transport timeout", async () => {
  const caller = new AbortController();
  const request = transport.fetchWithTimeout(
    abortingFetch,
    "https://example.invalid",
    { signal: caller.signal },
    5_000,
  );
  caller.abort();
  await assert.rejects(request, (error) => {
    assert.equal(error.message, "ABORTED");
    assert.equal(error instanceof transport.PosApiRequestTimeoutError, false);
    return true;
  });
});

test("MOB-09 successful requests clear their deadline and preserve the response", async () => {
  let suppliedSignal;
  const response = new Response("ready", { status: 200 });
  const result = await transport.fetchWithTimeout(
    async (_input, init) => {
      suppliedSignal = init.signal;
      return response;
    },
    "https://example.invalid",
    {},
    100,
  );
  assert.equal(result, response);
  assert.equal(suppliedSignal.aborted, false);
});

test("MOB-09 both initial and refreshed-token attempts use the bounded transport", () => {
  assert.equal((apiSource.match(/fetchWithTimeout\(fetch/g) ?? []).length, 2);
  assert.match(apiSource, /let retried = false/);
  assert.match(apiSource, /response\.status === 401[\s\S]*retried = true/);
  assert.match(
    apiSource,
    /recordApiCall\([^]*retried,\s*failed: !response\.ok/,
  );
  assert.match(apiSource, /REQUEST_TIMEOUT/);
});
