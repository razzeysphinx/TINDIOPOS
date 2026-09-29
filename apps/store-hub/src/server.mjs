import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { createStoreHubJournal } from "./journal.mjs";
import { validateStoreHubEvent } from "./protocol.mjs";

const organizationId =
  process.env.TINDIO_STORE_HUB_ORGANIZATION_ID?.trim();

const storeId =
  process.env.TINDIO_STORE_HUB_STORE_ID?.trim();

const token =
  process.env.TINDIO_STORE_HUB_TOKEN?.trim();

const port = Number(
  process.env.TINDIO_STORE_HUB_PORT ?? "8787",
);

const host =
  process.env.TINDIO_STORE_HUB_HOST?.trim()
  || "0.0.0.0";

const dataDir = resolve(
  process.env.TINDIO_STORE_HUB_DATA_DIR?.trim()
  || ".tindio-store-hub",
);

if (!organizationId || !storeId) {
  throw new Error(
    "Store Hub organization/store scope is required.",
  );
}

if (!token || token.length < 32) {
  throw new Error(
    "TINDIO_STORE_HUB_TOKEN must contain at least 32 characters.",
  );
}

if (
  !Number.isInteger(port)
  || port < 1
  || port > 65_535
) {
  throw new Error("TINDIO_STORE_HUB_PORT is invalid.");
}

const journal = createStoreHubJournal({
  dataDir,
  organizationId,
  storeId,
});

function json(response, status, body) {
  const payload = JSON.stringify(body);

  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });

  response.end(payload);
}

function authorized(request) {
  const header = request.headers.authorization ?? "";
  const expected = `Bearer ${token}`;

  const left = Buffer.from(header);
  const right = Buffer.from(expected);

  return left.length === right.length
    && timingSafeEqual(left, right);
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;

  for await (const chunk of request) {
    bytes += chunk.length;

    if (bytes > 256 * 1024) {
      throw new Error("BODY_TOO_LARGE");
    }

    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");

  return raw ? JSON.parse(raw) : null;
}

const server = createServer(async (request, response) => {
  if (!authorized(request)) {
    json(response, 401, {
      ok: false,
      reason: "STORE_HUB_UNAUTHORIZED",
    });
    return;
  }

  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );

  if (
    request.method === "GET"
    && url.pathname === "/health"
  ) {
    json(response, 200, {
      ok: true,
      mode: "STORE_LOCAL",
      organizationId,
      storeId,
      currentRevision: journal.revision,
      now: new Date().toISOString(),
    });
    return;
  }

  if (
    request.method === "POST"
    && url.pathname === "/v1/events"
  ) {
    try {
      const parsed = validateStoreHubEvent(
        await readJson(request),
      );

      if (!parsed.ok) {
        json(response, 400, parsed);
        return;
      }

      if (
        parsed.event.organizationId !== organizationId
        || parsed.event.storeId !== storeId
      ) {
        json(response, 403, {
          ok: false,
          reason: "STORE_HUB_SCOPE_MISMATCH",
        });
        return;
      }

      const result = journal.upsert(parsed.event);

      if (!result.ok) {
        json(response, 409, result);
        return;
      }

      json(response, 200, {
        ok: true,
        replayed: result.replayed,
        hubRevision: result.hubRevision,
      });
    } catch (error) {
      json(
        response,
        error instanceof Error
          && error.message === "BODY_TOO_LARGE"
          ? 413
          : 400,
        {
          ok: false,
          reason: "STORE_HUB_EVENT_INVALID",
        },
      );
    }

    return;
  }

  if (
    request.method === "GET"
    && url.pathname === "/v1/events"
  ) {
    const after = Number(url.searchParams.get("after") ?? "0");
    const requestedLimit = Number(
      url.searchParams.get("limit") ?? "100",
    );

    if (
      !Number.isSafeInteger(after)
      || after < 0
      || !Number.isInteger(requestedLimit)
      || requestedLimit < 1
    ) {
      json(response, 400, {
        ok: false,
        reason: "STORE_HUB_CURSOR_INVALID",
      });
      return;
    }

    const limit = Math.min(requestedLimit, 200);
    const page = journal.readAfter(after, limit);

    json(response, 200, {
      ok: true,
      organizationId,
      storeId,
      ...page,
    });
    return;
  }

  json(response, 404, {
    ok: false,
    reason: "STORE_HUB_ROUTE_NOT_FOUND",
  });
});

server.listen(port, host, () => {
  console.log(
    `TINDIO Store Hub listening on ${host}:${port} for ${organizationId}/${storeId}`,
  );
});

const stop = () => {
  server.close(() => process.exit(0));
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
