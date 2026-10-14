import assert from "node:assert/strict";

process.loadEnvFile(".env.local");

const organizationId =
  "baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9";
const baseUrl = (
  process.env.TINDIO_A43_BASE_URL
  ?? "http://127.0.0.1:3000"
).replace(/\/+$/u, "");

function required(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required.`);
  return value;
}

const authResponse = await fetch(
  `${required("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/u, "")}/auth/v1/token?grant_type=password`,
  {
    method: "POST",
    headers: {
      apikey: required(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      ),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: required("TINDIO_PHASE_04_TEST_EMAIL"),
      password: required("TINDIO_PHASE_04_TEST_PASSWORD"),
    }),
    signal: AbortSignal.timeout(30_000),
  },
);
const auth = await authResponse.json();
assert.equal(authResponse.status, 200);
assert.equal(typeof auth.access_token, "string");

const response = await fetch(
  `${baseUrl}/api/pos/v2/shifts/close`,
  {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${auth.access_token}`,
      "Content-Type": "application/json",
      "x-tindio-organization-id": organizationId,
    },
    body: JSON.stringify({
      shiftId: "11111111-1111-4111-8111-111111111111",
      countedCash: "100.00",
      closingNote: "A43 audit-baseline client request",
    }),
    signal: AbortSignal.timeout(30_000),
  },
);
const body = await response.json();

assert.equal(
  response.status,
  426,
  `Unexpected A43 response: ${JSON.stringify(body)}`,
);
assert.deepEqual(body, {
  ok: false,
  code: "POS_CLIENT_UPGRADE_REQUIRED",
  requiredCapability: "SHIFT_CUSTODY_FINALIZATION_V1",
  retryable: false,
  preservesRecovery: true,
  message:
    "Update TINDIO POS before closing this shift. The shift remains open and pending transactions are preserved.",
});

console.log(JSON.stringify({
  acceptanceId: "A43",
  baselineCommit:
    "bd18a3c88862ce0265d31c5e749d2257b57dac49",
  endpoint: "/api/pos/v2/shifts/close",
  status: response.status,
  code: body.code,
  retryable: body.retryable,
  preservesRecovery: body.preservesRecovery,
}));
