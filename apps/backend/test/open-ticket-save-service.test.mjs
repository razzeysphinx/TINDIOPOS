import assert from "node:assert/strict";
import test from "node:test";

import { serveOpenTicketSave } from "../dist/src/pos/open-ticket-save-service.js";

const request = () => new Request(
  "https://backend.tindio.test/api/pos/v2/tickets/save",
  { method: "POST" },
);

test("open-ticket save service defaults to owned mode", async () => {
  let created = false;
  const response = await serveOpenTicketSave(request(), {
    mode: undefined,
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { created = true; throw new Error("configured-owned-proof"); },
  });
  assert.equal(created, true);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "OPEN_TICKET_SAVE_BACKEND_UNAVAILABLE");
});

test("open-ticket save service rejects unknown modes", async () => {
  const response = await serveOpenTicketSave(request(), {
    mode: "unknown",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { throw new Error("must not run"); },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "OPEN_TICKET_SAVE_BACKEND_UNAVAILABLE");
});

test("open-ticket save proxy mode never constructs owned dependencies", async () => {
  let created = false;
  const response = await serveOpenTicketSave(request(), {
    mode: "proxy",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { created = true; throw new Error("must not run"); },
  });
  assert.equal(created, false);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "OPEN_TICKET_SAVE_UPSTREAM_UNAVAILABLE");
});
