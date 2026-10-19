export const POS_BOOTSTRAP_PATH = "/api/pos/v2/bootstrap";

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

type BootstrapFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type BootstrapProxyOptions = {
  upstreamOrigin: string | undefined;
  createRequestId: () => string;
  fetchImpl?: BootstrapFetch;
};

function unavailableResponse(
  requestId: string,
): Response {
  const response = Response.json(
    {
      ok: false,
      reason: "BOOTSTRAP_UPSTREAM_UNAVAILABLE",
      requestId,
    },
    {
      status: 503,
      headers: {
        "cache-control": "private, no-store",
      },
    },
  );

  response.headers.set(
    "x-tindio-request-id",
    requestId,
  );

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

    return new URL(POS_BOOTSTRAP_PATH, upstream.origin);
  } catch {
    return null;
  }
}

function forwardedRequestHeaders(
  request: Request,
): Headers {
  const headers = new Headers();

  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);

    if (value !== null) {
      headers.set(name, value);
    }
  }

  return headers;
}

function forwardedResponseHeaders(
  response: Response,
): Headers {
  const headers = new Headers();

  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = response.headers.get(name);

    if (value !== null) {
      headers.set(name, value);
    }
  }

  return headers;
}

export async function proxyPosBootstrap(
  request: Request,
  {
    upstreamOrigin,
    createRequestId,
    fetchImpl = fetch,
  }: BootstrapProxyOptions,
): Promise<Response> {
  const upstreamUrl = resolveUpstreamUrl(
    request,
    upstreamOrigin,
  );

  if (!upstreamUrl) {
    return unavailableResponse(
      createRequestId(),
    );
  }

  try {
    const upstreamResponse = await fetchImpl(
      upstreamUrl,
      {
        method: "GET",
        headers: forwardedRequestHeaders(request),
        cache: "no-store",
        redirect: "manual",
        signal: request.signal,
      },
    );

    return new Response(
      upstreamResponse.body,
      {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: forwardedResponseHeaders(
          upstreamResponse,
        ),
      },
    );
  } catch {
    const requestId = createRequestId();

    console.error(
      "TINDIO_BACKEND_BOOTSTRAP_UPSTREAM_UNAVAILABLE",
      { requestId },
    );

    return unavailableResponse(requestId);
  }
}
