export const POS_CATALOG_PATH = "/api/pos/v2/catalog";

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "authorization",
  "x-tindio-organization-id",
] as const;

const FORWARDED_RESPONSE_HEADERS = [
  "cache-control",
  "content-type",
  "retry-after",
  "x-tindio-request-id",
] as const;

type CatalogProxyOptions = {
  upstreamOrigin: string | undefined;
  createRequestId: () => string;
  fetchImpl?: typeof fetch;
};

function unavailableResponse(requestId: string): Response {
  const response = Response.json(
    { ok: false, reason: "CATALOG_UPSTREAM_UNAVAILABLE", requestId },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

function resolveUpstreamUrl(
  request: Request,
  upstreamOrigin: string | undefined,
): URL | null {
  if (!upstreamOrigin) return null;

  try {
    const upstream = new URL(upstreamOrigin);
    const requestUrl = new URL(request.url);

    if (
      !["http:", "https:"].includes(upstream.protocol)
      || upstream.username
      || upstream.password
      || (upstream.pathname !== "/" && upstream.pathname !== "")
      || upstream.search
      || upstream.hash
      || upstream.origin === requestUrl.origin
    ) return null;

    const url = new URL(POS_CATALOG_PATH, upstream.origin);
    url.search = requestUrl.search;
    return url;
  } catch {
    return null;
  }
}

function allowlistedHeaders(
  source: { headers: Headers },
  names: readonly string[],
): Headers {
  const headers = new Headers();
  for (const name of names) {
    const value = source.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

export async function proxyPosCatalog(
  request: Request,
  { upstreamOrigin, createRequestId, fetchImpl = fetch }: CatalogProxyOptions,
): Promise<Response> {
  const upstreamUrl = resolveUpstreamUrl(request, upstreamOrigin);
  if (!upstreamUrl) return unavailableResponse(createRequestId());

  try {
    const upstreamResponse = await fetchImpl(upstreamUrl, {
      method: "GET",
      headers: allowlistedHeaders(request, FORWARDED_REQUEST_HEADERS),
      cache: "no-store",
      redirect: "manual",
      signal: request.signal,
    });

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: allowlistedHeaders(upstreamResponse, FORWARDED_RESPONSE_HEADERS),
    });
  } catch {
    const requestId = createRequestId();
    console.error("TINDIO_BACKEND_CATALOG_UPSTREAM_UNAVAILABLE", { requestId });
    return unavailableResponse(requestId);
  }
}
