import type { OwnedFavoriteTileDependencies } from "./favorite-tile-owned.js";
import { handleOwnedFavoriteTileUpdate } from "./favorite-tile-owned.js";
import { proxyFavoriteTileUpdate } from "./favorite-tile-proxy.js";

type FavoriteTileServiceOptions = {
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedFavoriteTileDependencies;
};

function configurationFailure(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json(
    { ok: false, reason: "FAVORITE_TILE_BACKEND_UNAVAILABLE", requestId },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

export async function serveFavoriteTileUpdate(
  request: Request,
  options: FavoriteTileServiceOptions,
): Promise<Response> {
  const mode = options.mode ?? "owned";
  if (mode === "proxy") {
    return proxyFavoriteTileUpdate(request, {
      upstreamOrigin: options.upstreamOrigin,
      createRequestId: options.createRequestId,
    });
  }
  if (mode !== "owned") return configurationFailure(options.createRequestId);

  try {
    return await handleOwnedFavoriteTileUpdate(
      request,
      options.createOwnedDependencies(),
    );
  } catch {
    return configurationFailure(options.createRequestId);
  }
}
