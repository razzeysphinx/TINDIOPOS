import type { OwnedModifiersDependencies } from "./modifiers-owned.js";
import { handleOwnedPosModifiers } from "./modifiers-owned.js";
import { proxyPosModifiers } from "./modifiers-proxy.js";

type ModifiersServiceOptions = {
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedModifiersDependencies;
};

function configurationFailure(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json(
    { ok: false, reason: "MODIFIERS_BACKEND_UNAVAILABLE", requestId },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

export async function servePosModifiers(
  request: Request,
  options: ModifiersServiceOptions,
): Promise<Response> {
  const mode = options.mode ?? "owned";

  if (mode === "proxy") {
    return proxyPosModifiers(request, {
      upstreamOrigin: options.upstreamOrigin,
      createRequestId: options.createRequestId,
    });
  }

  if (mode !== "owned") return configurationFailure(options.createRequestId);

  try {
    return await handleOwnedPosModifiers(
      request,
      options.createOwnedDependencies(),
    );
  } catch {
    return configurationFailure(options.createRequestId);
  }
}
