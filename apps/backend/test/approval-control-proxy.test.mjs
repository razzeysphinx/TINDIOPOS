import assert from "node:assert/strict";
import test from "node:test";
import { proxyApprovalControl } from "../dist/src/pos/approval-control-proxy.js";

const REQUEST_ID = "40000000-0000-4000-8000-000000000001";
const routes = [
  ["POST", "/api/pos/v2/approvals/request"],
  ["POST", `/api/pos/v2/approvals/${REQUEST_ID}/approve`],
  ["GET", `/api/pos/v2/approvals/${REQUEST_ID}`],
];
for (const [method, path] of routes) {
  for (const status of [200, 400, 401, 403, 500, 503]) {
    test(`approval-control proxy preserves ${method} ${path} and ${status} contract`, async () => {
      let observed;
      const response = await proxyApprovalControl(new Request(`https://backend.test${path}?source=mobile`, {
        method,
        headers: { accept: "application/json", authorization: "Bearer token", "content-type": "application/json", "x-tindio-organization-id": "organization", cookie: "drop=1", "x-tindio-device-secret": "drop" },
        ...(method === "POST" ? { body: JSON.stringify({ value: status }) } : {}),
      }), {
        upstreamOrigin: "https://web.test", createRequestId: () => "id",
        fetchImpl: async (url, init) => { observed = { url: String(url), init }; return Response.json({ status }, { status, headers: { "cache-control": "private, no-store", "x-tindio-request-id": "upstream", "set-cookie": "drop=1" } }); },
      });
      assert.equal(response.status, status); assert.equal(observed.url, `https://web.test${path}?source=mobile`); assert.equal(observed.init.method, method);
      if (method === "POST") assert.deepEqual(JSON.parse(new TextDecoder().decode(observed.init.body)), { value: status });
      else assert.equal(observed.init.body, undefined);
      assert.equal(observed.init.headers.get("authorization"), "Bearer token"); assert.equal(observed.init.headers.get("x-tindio-organization-id"), "organization");
      assert.equal(observed.init.headers.get("cookie"), null); assert.equal(observed.init.headers.get("x-tindio-device-secret"), null);
      assert.equal(response.headers.get("x-tindio-request-id"), "upstream"); assert.equal(response.headers.get("set-cookie"), null);
    });
  }
}

test("approval-control proxy fails closed for unsafe origins, paths, and methods", async () => {
  for (const [method, url, origin] of [
    ["POST", "https://backend.test/api/pos/v2/approvals/request", undefined],
    ["POST", "https://backend.test/api/pos/v2/approvals/request", "https://backend.test"],
    ["GET", "https://backend.test/api/pos/v2/approvals/request", "https://web.test"],
    ["POST", `https://backend.test/api/pos/v2/approvals/${REQUEST_ID}`, "https://web.test"],
    ["GET", `https://backend.test/api/pos/v2/approvals/${REQUEST_ID}/approve`, "https://web.test"],
    ["GET", `https://backend.test/api/pos/v2/approvals/${REQUEST_ID}/nested`, "https://web.test"],
  ]) {
    const response = await proxyApprovalControl(new Request(url, { method }), { upstreamOrigin: origin, createRequestId: () => "id" });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, reason: "APPROVAL_CONTROL_UPSTREAM_UNAVAILABLE", requestId: "id" });
  }
});
