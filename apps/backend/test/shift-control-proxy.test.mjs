import assert from "node:assert/strict";
import test from "node:test";
import { proxyShiftControl } from "../dist/src/pos/shift-control-proxy.js";

const paths = ["/api/pos/v2/shifts/open", "/api/pos/v2/shifts/close", "/api/pos/v2/shifts/custody", "/api/pos/v2/shifts/cash-movement"];
const statuses = [200, 426, 403, 503];
for (const [index, path] of paths.entries()) test(`shift-control proxy preserves ${path} body and response contract`, async () => {
  let observed;
  const status = statuses[index];
  const response = await proxyShiftControl(new Request(`https://backend.test${path}?source=mobile`, { method: "POST", headers: { accept: "application/json", authorization: "Bearer token", "content-type": "application/json", "x-tindio-organization-id": "organization", cookie: "drop", "x-tindio-device-secret": "drop" }, body: JSON.stringify({ value: status }) }), {
    upstreamOrigin: "https://web.test", createRequestId: () => "id", fetchImpl: async (url, init) => { observed = { url: String(url), init }; return Response.json({ status }, { status, headers: { "cache-control": "private, no-store", "x-tindio-request-id": "upstream", "set-cookie": "drop=1" } }); },
  });
  assert.equal(response.status, status); assert.equal(observed.url, `https://web.test${path}?source=mobile`); assert.deepEqual(JSON.parse(new TextDecoder().decode(observed.init.body)), { value: status });
  assert.equal(observed.init.headers.get("authorization"), "Bearer token"); assert.equal(observed.init.headers.get("x-tindio-organization-id"), "organization"); assert.equal(observed.init.headers.get("cookie"), null); assert.equal(observed.init.headers.get("x-tindio-device-secret"), null);
  assert.equal(response.headers.get("x-tindio-request-id"), "upstream"); assert.equal(response.headers.get("set-cookie"), null);
});

test("shift-control proxy fails closed for unsafe origins and paths", async () => {
  for (const [url, origin] of [["https://backend.test/api/pos/v2/shifts/open", undefined], ["https://backend.test/api/pos/v2/shifts/open", "https://backend.test"], ["https://backend.test/api/pos/v2/approvals/request", "https://web.test"]]) {
    const response = await proxyShiftControl(new Request(url, { method: "POST" }), { upstreamOrigin: origin, createRequestId: () => "id" });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, reason: "SHIFT_CONTROL_UPSTREAM_UNAVAILABLE", requestId: "id" });
  }
});
