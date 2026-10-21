import assert from "node:assert/strict";
import test from "node:test";

import { serveOpenTicketMoveLines } from "../dist/src/pos/open-ticket-move-lines-service.js";

const request = () => new Request(
  "https://backend.tindio.test/api/pos/v2/tickets/move-lines",
  { method: "POST" },
);

test("open-ticket line-movement service defaults to owned mode", async () => {
  let created = false;
  const response = await serveOpenTicketMoveLines(request(), {
    mode: undefined,
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { created = true; throw new Error("configured-owned-proof"); },
  });
  assert.equal(created, true);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "OPEN_TICKET_MOVE_LINES_BACKEND_UNAVAILABLE");
});

test("open-ticket line-movement service rejects unknown modes", async () => {
  const response = await serveOpenTicketMoveLines(request(), {
    mode: "unknown",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { throw new Error("must not run"); },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "OPEN_TICKET_MOVE_LINES_BACKEND_UNAVAILABLE");
});

test("open-ticket line-movement proxy mode never constructs owned dependencies", async () => {
  let created = false;
  const response = await serveOpenTicketMoveLines(request(), {
    mode: "proxy",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { created = true; throw new Error("must not run"); },
  });
  assert.equal(created, false);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "OPEN_TICKET_MOVE_LINES_UPSTREAM_UNAVAILABLE");
});
