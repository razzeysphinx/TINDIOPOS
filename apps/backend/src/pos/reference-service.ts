import type { OwnedReferenceDependencies } from "./reference-owned.js";
import { handleOwnedPosReference } from "./reference-owned.js";
import { proxyPosReference } from "./reference-proxy.js";

type ReferenceServiceOptions = {
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedReferenceDependencies;
};

function configurationFailure(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json(
    {
      ok: false,
      reason: "REFERENCE_BACKEND_UNAVAILABLE",
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

export async function servePosReference(
  request: Request,
  options: ReferenceServiceOptions,
): Promise<Response> {
  const mode = options.mode ?? "owned";

  if (mode === "proxy") {
    return proxyPosReference(request, {
      upstreamOrigin: options.upstreamOrigin,
      createRequestId: options.createRequestId,
    });
  }

  if (mode !== "owned") {
    return configurationFailure(options.createRequestId);
  }

  try {
    return await handleOwnedPosReference(
      request,
      options.createOwnedDependencies(),
    );
  } catch {
    return configurationFailure(options.createRequestId);
  }
}
