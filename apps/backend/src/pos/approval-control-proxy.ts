import {
  POS_APPROVAL_APPROVE_PATH_PATTERN,
  POS_APPROVAL_DETAIL_PATH_PATTERN,
  POS_APPROVAL_REQUEST_PATH,
} from "@tindio/contracts/approval-control";

const REQUEST_HEADERS = ["accept", "authorization", "content-type", "x-tindio-organization-id"] as const;
const RESPONSE_HEADERS = ["cache-control", "content-type", "retry-after", "x-tindio-request-id"] as const;
type Options = { upstreamOrigin: string | undefined; createRequestId: () => string; fetchImpl?: typeof fetch };

function unavailable(requestId: string): Response {
  const response = Response.json({ ok: false, reason: "APPROVAL_CONTROL_UPSTREAM_UNAVAILABLE", requestId }, { status: 503, headers: { "cache-control": "private, no-store" } });
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}
function headers(source: { headers: Headers }, names: readonly string[]): Headers {
  const result = new Headers();
  for (const name of names) { const value = source.headers.get(name); if (value !== null) result.set(name, value); }
  return result;
}
function allowed(method: string, pathname: string): boolean {
  return (method === "POST" && pathname === POS_APPROVAL_REQUEST_PATH)
    || (method === "POST" && POS_APPROVAL_APPROVE_PATH_PATTERN.test(pathname))
    || (method === "GET" && POS_APPROVAL_DETAIL_PATH_PATTERN.test(pathname));
}
function upstream(request: Request, origin: string | undefined): URL | null {
  if (!origin) return null;
  try {
    const base = new URL(origin);
    const input = new URL(request.url);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || (base.pathname !== "/" && base.pathname !== "") || base.search || base.hash || base.origin === input.origin || !allowed(request.method, input.pathname)) return null;
    const result = new URL(input.pathname, base.origin); result.search = input.search; return result;
  } catch { return null; }
}
export async function proxyApprovalControl(request: Request, options: Options): Promise<Response> {
  const url = upstream(request, options.upstreamOrigin);
  if (!url) return unavailable(options.createRequestId());
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: request.method,
      headers: headers(request, REQUEST_HEADERS),
      ...(request.method === "GET" ? {} : { body: await request.arrayBuffer() }),
      cache: "no-store",
      redirect: "manual",
      signal: request.signal,
    });
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: headers(response, RESPONSE_HEADERS) });
  } catch {
    const requestId = options.createRequestId();
    console.error("TINDIO_BACKEND_APPROVAL_CONTROL_UPSTREAM_UNAVAILABLE", { requestId });
    return unavailable(requestId);
  }
}
