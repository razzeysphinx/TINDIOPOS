import assert from "node:assert/strict";
import test from "node:test";
import { proxyDeviceSync } from "../dist/src/pos/device-sync-proxy.js";
const paths = ["/api/pos/v2/device", "/api/pos/v2/device/enroll", "/api/pos/v2/sync/baseline", "/api/pos/v2/sync/checkpoint", "/api/pos/v2/sync/pull", "/api/pos/v2/sync/resnapshot", "/api/pos/v2/sync/telemetry"];
for (const path of paths) test(`device-sync proxy preserves ${path} and allowlists headers`, async () => {
  let observed;
  const response = await proxyDeviceSync(new Request(`https://backend.test${path}?source=mobile`, { method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json", cookie: "drop", "x-tindio-device-secret": "drop" }, body: "{}" }), {
    upstreamOrigin: "https://web.test", createRequestId: () => "id", fetchImpl: async (url, init) => { observed = { url: String(url), init }; return Response.json({ ok: true }, { status: 200, headers: { "x-tindio-request-id": "upstream", "set-cookie": "drop" } }); },
  });
  assert.equal(observed.url, `https://web.test${path}?source=mobile`); assert.equal(observed.init.headers.get("authorization"), "Bearer token"); assert.equal(observed.init.headers.get("cookie"), null); assert.equal(observed.init.headers.get("x-tindio-device-secret"), null); assert.equal(response.headers.get("x-tindio-request-id"), "upstream"); assert.equal(response.headers.get("set-cookie"), null);
});
test("device-sync proxy fails closed for invalid origins and paths", async () => {
  for (const [url, origin] of [["https://backend.test/api/pos/v2/device", undefined], ["https://backend.test/api/pos/v2/device", "https://backend.test"], ["https://backend.test/api/pos/v2/sync/push", "https://web.test"]]) {
    const response = await proxyDeviceSync(new Request(url, { method: "POST" }), { upstreamOrigin: origin, createRequestId: () => "id" });
    assert.equal(response.status, 503); assert.equal((await response.json()).reason, "DEVICE_SYNC_UPSTREAM_UNAVAILABLE");
  }
});
