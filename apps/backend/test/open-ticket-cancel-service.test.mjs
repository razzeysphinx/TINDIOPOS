import assert from "node:assert/strict";
import test from "node:test";

import { serveOpenTicketCancel } from "../dist/src/pos/open-ticket-cancel-service.js";

const request = () => new Request(
  "https://backend.tindio.test/api/pos/v2/tickets/cancel",
  { method: "POST" },
);

test("open-ticket cancel service defaults to owned mode", async () => {
  let created = false;
  const response = await serveOpenTicketCancel(request(), {
    mode: undefined,
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { created = true; throw new Error("configured-owned-proof"); },
  });
  assert.equal(created, true);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "OPEN_TICKET_CANCEL_BACKEND_UNAVAILABLE");
});

test("open-ticket cancel service rejects unknown modes", async () => {
  const response = await serveOpenTicketCancel(request(), {
    mode: "unknown",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { throw new Error("must not run"); },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "OPEN_TICKET_CANCEL_BACKEND_UNAVAILABLE");
});

test("open-ticket cancel proxy mode never constructs owned dependencies", async () => {
  let created = false;
  const response = await serveOpenTicketCancel(request(), {
    mode: "proxy",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { created = true; throw new Error("must not run"); },
  });
  assert.equal(created, false);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "OPEN_TICKET_CANCEL_UPSTREAM_UNAVAILABLE");
});
