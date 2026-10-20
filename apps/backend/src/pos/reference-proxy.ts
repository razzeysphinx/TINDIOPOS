export const POS_REFERENCE_PATH = "/api/pos/v2/reference";

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "authorization",
  "x-tindio-organization-id",
] as const;

const FORWARDED_RESPONSE_HEADERS = [
  "cache-control",
  "content-type",
  "etag",
  "retry-after",
  "x-tindio-reference-version",
  "x-tindio-request-id",
] as const;

type ReferenceFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type ReferenceProxyOptions = {
  upstreamOrigin: string | undefined;
  createRequestId: () => string;
  fetchImpl?: ReferenceFetch;
};

function unavailableResponse(requestId: string): Response {
  const response = Response.json(
    {
      ok: false,
      reason: "REFERENCE_UPSTREAM_UNAVAILABLE",
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

function resolveUpstreamUrl(
  request: Request,
  upstreamOrigin: string | undefined,
): URL | null {
  if (!upstreamOrigin) {
    return null;
  }

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
    ) {
      return null;
    }

    return new URL(POS_REFERENCE_PATH, upstream.origin);
  } catch {
    return null;
  }
}

function requestHeaders(request: Request): Headers {
  const headers = new Headers();

  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);

    if (value !== null) {
      headers.set(name, value);
    }
  }

  return headers;
}

function responseHeaders(response: Response): Headers {
  const headers = new Headers();

  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = response.headers.get(name);

    if (value !== null) {
      headers.set(name, value);
    }
  }

  return headers;
}

export async function proxyPosReference(
  request: Request,
  {
    upstreamOrigin,
    createRequestId,
    fetchImpl = fetch,
  }: ReferenceProxyOptions,
): Promise<Response> {
  const upstreamUrl = resolveUpstreamUrl(request, upstreamOrigin);

  if (!upstreamUrl) {
    return unavailableResponse(createRequestId());
  }

  try {
    const upstreamResponse = await fetchImpl(upstreamUrl, {
      method: "GET",
      headers: requestHeaders(request),
      cache: "no-store",
      redirect: "manual",
      signal: request.signal,
    });

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders(upstreamResponse),
    });
  } catch {
    const requestId = createRequestId();

    console.error(
      "TINDIO_BACKEND_REFERENCE_UPSTREAM_UNAVAILABLE",
      { requestId },
    );

    return unavailableResponse(requestId);
  }
}
