import assert from "node:assert/strict";
import test from "node:test";

import { proxyAttendanceMutation } from "../dist/src/pos/attendance-mutation-proxy.js";

for (const action of ["clock-in", "clock-out"]) {
  for (const status of [200, 400, 401, 403, 500, 503]) {
    test(`attendance ${action} proxy preserves path, body, and ${status} contract`, async () => {
      const path = `/api/pos/v2/attendance/${action}`;
      let observed;
      const response = await proxyAttendanceMutation(new Request(`https://backend.test${path}?source=mobile`, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer token",
          "content-type": "application/json",
          cookie: "secret=drop",
          "x-tindio-device-secret": "drop",
          "x-tindio-organization-id": "organization",
        },
        body: JSON.stringify({ value: status }),
      }), {
        upstreamOrigin: "https://web.test",
        createRequestId: () => "request-id",
        fetchImpl: async (url, init) => {
          observed = { url: String(url), init };
          return new Response(JSON.stringify({ status }), {
            status,
            headers: {
              "cache-control": "private, no-store",
              "content-type": "application/json",
              "x-tindio-request-id": "upstream-id",
              "set-cookie": "drop=1",
            },
          });
        },
      });
      assert.equal(response.status, status);
      assert.equal(observed.url, `https://web.test${path}?source=mobile`);
      assert.equal(observed.init.method, "POST");
      assert.deepEqual(JSON.parse(new TextDecoder().decode(observed.init.body)), { value: status });
      assert.equal(observed.init.headers.get("authorization"), "Bearer token");
      assert.equal(observed.init.headers.get("cookie"), null);
      assert.equal(observed.init.headers.get("x-tindio-device-secret"), null);
      assert.equal(response.headers.get("x-tindio-request-id"), "upstream-id");
      assert.equal(response.headers.get("set-cookie"), null);
    });
  }
}

test("attendance mutation proxy fails closed for unsafe origins and non-attendance paths", async () => {
  for (const [url, upstreamOrigin] of [
    ["https://backend.test/api/pos/v2/attendance/clock-in", undefined],
    ["https://backend.test/api/pos/v2/attendance/clock-out", "https://backend.test"],
    ["https://backend.test/api/pos/v2/attendance/employees", "https://web.test"],
    ["https://backend.test/api/pos/v2/attendance/clock-in/nested", "https://web.test"],
  ]) {
    const response = await proxyAttendanceMutation(new Request(url, { method: "POST" }), {
      upstreamOrigin,
      createRequestId: () => "request-id",
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      reason: "ATTENDANCE_MUTATION_UPSTREAM_UNAVAILABLE",
      requestId: "request-id",
    });
  }
});
