import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import test from "node:test";
import ts from "typescript";

async function loadTypeScriptModule(file) {
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: file,
  }).outputText;

  return import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
}

async function runHubToExit(environment) {
  const child = spawn(process.execPath, ["apps/store-hub/src/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TINDIO_STORE_HUB_ORGANIZATION_ID:
        "11111111-1111-4111-8111-111111111111",
      TINDIO_STORE_HUB_STORE_ID:
        "22222222-2222-4222-8222-222222222222",
      TINDIO_STORE_HUB_TOKEN:
        "A40-store-hub-transport-token-2026",
      ...environment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });

  return { exitCode, output };
}

test("A40 release policy accepts HTTPS and rejects HTTP", async () => {
  const policy = await loadTypeScriptModule(
    "apps/mobile/src/features/store-hub/store-hub-transport-policy.ts",
  );

  assert.equal(
    policy.isStoreHubTransportAllowed({
      protocol: "https:",
      allowInsecureHttp: false,
    }),
    true,
  );
  assert.equal(
    policy.isStoreHubTransportAllowed({
      protocol: "http:",
      allowInsecureHttp: false,
    }),
    false,
  );
  assert.equal(
    policy.isStoreHubTransportAllowed({
      protocol: "http:",
      allowInsecureHttp: true,
    }),
    true,
  );
});

test("A40 Store Hub fails closed when TLS is absent or incomplete", async () => {
  const withoutTls = await runHubToExit({
    NODE_ENV: "production",
    TINDIO_STORE_HUB_ALLOW_INSECURE_HTTP: "1",
    TINDIO_STORE_HUB_TLS_CERT_PATH: "",
    TINDIO_STORE_HUB_TLS_KEY_PATH: "",
  });
  assert.notEqual(withoutTls.exitCode, 0);
  assert.match(withoutTls.output, /Store Hub requires TLS/);

  const incompleteTls = await runHubToExit({
    NODE_ENV: "production",
    TINDIO_STORE_HUB_TLS_CERT_PATH: "missing-cert.pem",
    TINDIO_STORE_HUB_TLS_KEY_PATH: "",
  });
  assert.notEqual(incompleteTls.exitCode, 0);
  assert.match(
    incompleteTls.output,
    /certificate and private-key paths must be configured together/,
  );
});

test("A40 uses native TLS without weakening Android cleartext policy", () => {
  const server = readFileSync(
    "apps/store-hub/src/server.mjs",
    "utf8",
  );
  const appConfig = readFileSync(
    "apps/mobile/app.config.js",
    "utf8",
  );
  const settings = readFileSync(
    "apps/mobile/app/(app)/settings.tsx",
    "utf8",
  );
  const config = readFileSync(
    "apps/mobile/src/features/store-hub/store-hub-config.ts",
    "utf8",
  );

  assert.match(server, /createHttpsServer/);
  assert.match(server, /minVersion: "TLSv1\.2"/);
  assert.match(server, /Strict-Transport-Security/);
  assert.match(server, /NODE_ENV !== "production"/);
  assert.match(appConfig, /EAS_BUILD_PROFILE\s*=== "development"/);
  assert.match(appConfig, /usesCleartextTraffic/);
  assert.match(settings, /https:\/\/hub\.example\.local:8787/);
  assert.match(config, /STORE_HUB_HTTPS_REQUIRED/);
  assert.doesNotMatch(
    appConfig,
    /usesCleartextTraffic:\s*true/,
  );
});
