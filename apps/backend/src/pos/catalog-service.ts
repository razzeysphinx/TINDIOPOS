import type { OwnedCatalogDependencies } from "./catalog-owned.js";
import { handleOwnedPosCatalog } from "./catalog-owned.js";
import { proxyPosCatalog } from "./catalog-proxy.js";

type CatalogServiceOptions = {
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedCatalogDependencies;
};

function configurationFailure(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json(
    { ok: false, reason: "CATALOG_BACKEND_UNAVAILABLE", requestId },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

export async function servePosCatalog(
  request: Request,
  options: CatalogServiceOptions,
): Promise<Response> {
  const mode = options.mode ?? "owned";

  if (mode === "proxy") {
    return proxyPosCatalog(request, {
      upstreamOrigin: options.upstreamOrigin,
      createRequestId: options.createRequestId,
    });
  }

  if (mode !== "owned") return configurationFailure(options.createRequestId);

  try {
    return await handleOwnedPosCatalog(request, options.createOwnedDependencies());
  } catch {
    return configurationFailure(options.createRequestId);
  }
}
