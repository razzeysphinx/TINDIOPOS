import assert from "node:assert/strict";
import test from "node:test";

import { serveOpenTicketSplit } from "../dist/src/pos/open-ticket-split-service.js";

const request = () => new Request(
  "https://backend.tindio.test/api/pos/v2/tickets/split",
  { method: "POST" },
);

test("open-ticket split service defaults to owned mode", async () => {
  let created = false;
  const response = await serveOpenTicketSplit(request(), {
    mode: undefined,
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { created = true; throw new Error("configured-owned-proof"); },
  });
  assert.equal(created, true);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "OPEN_TICKET_SPLIT_BACKEND_UNAVAILABLE");
});

test("open-ticket split service rejects unknown modes", async () => {
  const response = await serveOpenTicketSplit(request(), {
    mode: "unknown",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { throw new Error("must not run"); },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "OPEN_TICKET_SPLIT_BACKEND_UNAVAILABLE");
});

test("open-ticket split proxy mode never constructs owned dependencies", async () => {
  let created = false;
  const response = await serveOpenTicketSplit(request(), {
    mode: "proxy",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { created = true; throw new Error("must not run"); },
  });
  assert.equal(created, false);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "OPEN_TICKET_SPLIT_UPSTREAM_UNAVAILABLE");
});
