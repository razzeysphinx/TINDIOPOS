import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const metricsPath =
  "apps/mobile/src/features/performance/performance-metrics.ts";
const apiPath = "apps/mobile/src/lib/tindio-api.ts";

async function loadTypeScriptModule(file) {
  const output = ts.transpileModule(
    fs.readFileSync(file, "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: file,
    },
  ).outputText;

  return import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
}

const metrics = await loadTypeScriptModule(metricsPath);

test("MOB-14 uses a valid declared response size without cloning the body", () => {
  let cloned = false;
  const response = {
    headers: new Headers({ "content-length": "27" }),
    clone() {
      cloned = true;
      throw new Error("clone must not be used");
    },
  };

  assert.equal(metrics.observeApiResponseBytes(response), 27);
  assert.equal(cloned, false);
});

test("MOB-14 measures an undeclared body without consuming the caller response", async () => {
  metrics.resetPerformanceMetrics();
  const original = new Response("seven!!");
  const declaredBytes = metrics.observeApiResponseBytes(original);

  assert.equal(declaredBytes, 0);
  assert.equal(original.bodyUsed, false);

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(metrics.getPerformanceMetrics().apiResponseBytes, 7);
  assert.equal(original.bodyUsed, false);
  assert.equal(await original.text(), "seven!!");
});

test("MOB-14 falls back for malformed, negative, and unsafe content lengths", () => {
  for (const value of ["invalid", "-1", "1.5", "9007199254740992"]) {
    assert.equal(
      metrics.declaredApiResponseBytes(
        new Headers({ "content-length": value }),
      ),
      null,
    );
  }
});

test("MOB-14 telemetry failure cannot fail or consume the API response", async () => {
  metrics.resetPerformanceMetrics();
  const response = {
    headers: new Headers(),
    clone() {
      throw new Error("unsupported clone");
    },
  };

  assert.doesNotThrow(() => metrics.observeApiResponseBytes(response));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(metrics.getPerformanceMetrics().apiResponseBytes, 0);
  assert.equal(metrics.getPerformanceMetrics().apiCalls, 0);
});

test("MOB-14 fallback bytes do not inflate API call, retry, or failure counts", async () => {
  metrics.resetPerformanceMetrics();
  metrics.recordApiCall({
    durationMs: 25,
    responseBytes: 0,
    retried: true,
    failed: false,
  });
  assert.equal(
    await metrics.measureApiResponseBytes(new Response("fallback")),
    8,
  );
  metrics.recordApiResponseBytes(8);

  const result = metrics.getPerformanceMetrics();
  assert.equal(result.apiCalls, 1);
  assert.equal(result.apiRetries, 1);
  assert.equal(result.apiFailures, 0);
  assert.equal(result.apiResponseBytes, 8);
});

test("MOB-14 API transport retains retry identity and observes final response bytes", () => {
  const source = fs.readFileSync(apiPath, "utf8");

  assert.match(source, /response\.status === 401[\s\S]*retried = true/);
  assert.match(
    source,
    /responseBytes:\s*observeApiResponseBytes\(response\)/,
  );
  assert.doesNotMatch(
    source,
    /responseBytes:\s*Number\(response\.headers\.get\("content-length"\)/,
  );
});
