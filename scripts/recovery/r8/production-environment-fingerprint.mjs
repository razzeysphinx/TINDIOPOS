import assert from "node:assert/strict";
import { createHash } from "node:crypto";

function required(name) {
  const value = process.env[name]?.trim();

  assert.ok(value, `${name} is missing from the Vercel production environment.`);

  return value;
}

const provider = required("TINDIO_DATABASE_PROVIDER");
const dataApiValue = required("NEON_DATA_API_URL");
const dataApi = new URL(dataApiValue);

assert.equal(dataApi.protocol, "https:", "NEON_DATA_API_URL must be HTTPS.");
assert.equal(
  dataApi.username,
  "",
  "NEON_DATA_API_URL must not contain URL user credentials.",
);
assert.equal(
  dataApi.password,
  "",
  "NEON_DATA_API_URL must not contain URL password credentials.",
);

const fingerprint = createHash("sha256").update(dataApiValue).digest("hex");

console.log(
  JSON.stringify(
    {
      databaseProvider: provider,
      neonDataApi: {
        protocol: dataApi.protocol,
        hostname: dataApi.hostname,
        port: dataApi.port || null,
        pathname: dataApi.pathname.replace(/\/+$/u, ""),
        valueSha256: fingerprint,
      },
    },
    null,
    2,
  ),
);
