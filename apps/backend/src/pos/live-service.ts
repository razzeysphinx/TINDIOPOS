import type { OwnedLiveDependencies } from "./live-owned.js";
import { handleOwnedPosLive } from "./live-owned.js";
import { proxyPosLive } from "./live-proxy.js";

type LiveServiceOptions = {
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedLiveDependencies;
};

function configurationFailure(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json(
    { ok: false, reason: "LIVE_BACKEND_UNAVAILABLE", requestId },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

export async function servePosLive(
  request: Request,
  options: LiveServiceOptions,
): Promise<Response> {
  const mode = options.mode ?? "owned";

  if (mode === "proxy") {
    return proxyPosLive(request, {
      upstreamOrigin: options.upstreamOrigin,
      createRequestId: options.createRequestId,
    });
  }
  if (mode !== "owned") return configurationFailure(options.createRequestId);

  try {
    return await handleOwnedPosLive(request, options.createOwnedDependencies());
  } catch {
    return configurationFailure(options.createRequestId);
  }
}
