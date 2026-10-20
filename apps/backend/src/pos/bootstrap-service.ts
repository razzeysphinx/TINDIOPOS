import type { OwnedBootstrapDependencies } from "./bootstrap-owned.js";
import { handleOwnedPosBootstrap } from "./bootstrap-owned.js";
import { proxyPosBootstrap } from "./bootstrap-proxy.js";

type BootstrapMode = "owned" | "proxy";

type BootstrapServiceOptions = {
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedBootstrapDependencies;
};

function configurationFailure(
  createRequestId: () => string,
): Response {
  const requestId = createRequestId();
  const response = Response.json(
    {
      ok: false,
      reason: "BOOTSTRAP_BACKEND_UNAVAILABLE",
      requestId,
    },
    {
      status: 503,
      headers: {
        "cache-control": "private, no-store",
      },
    },
  );

  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

export async function servePosBootstrap(
  request: Request,
  options: BootstrapServiceOptions,
): Promise<Response> {
  const mode = (options.mode ?? "owned") as BootstrapMode;

  if (mode === "proxy") {
    return proxyPosBootstrap(request, {
      upstreamOrigin: options.upstreamOrigin,
      createRequestId: options.createRequestId,
    });
  }

  if (mode !== "owned") {
    return configurationFailure(options.createRequestId);
  }

  try {
    return await handleOwnedPosBootstrap(
      request,
      options.createOwnedDependencies(),
    );
  } catch {
    return configurationFailure(options.createRequestId);
  }
}
