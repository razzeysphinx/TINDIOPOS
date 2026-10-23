import {
  POS_SHIFT_CASH_MOVEMENT_PATH,
  POS_SHIFT_CLOSE_PATH,
  POS_SHIFT_CUSTODY_PATH,
  POS_SHIFT_OPEN_PATH,
} from "@tindio/contracts/shift-control";

const PATHS = new Set<string>([POS_SHIFT_OPEN_PATH, POS_SHIFT_CLOSE_PATH, POS_SHIFT_CUSTODY_PATH, POS_SHIFT_CASH_MOVEMENT_PATH]);
const REQUEST_HEADERS = ["accept", "authorization", "content-type", "x-tindio-organization-id"] as const;
const RESPONSE_HEADERS = ["cache-control", "content-type", "retry-after", "x-tindio-request-id"] as const;
type Options = { upstreamOrigin: string | undefined; createRequestId: () => string; fetchImpl?: typeof fetch };

function unavailable(requestId: string): Response {
  const response = Response.json({ ok: false, reason: "SHIFT_CONTROL_UPSTREAM_UNAVAILABLE", requestId }, { status: 503, headers: { "cache-control": "private, no-store" } });
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}
function headers(source: { headers: Headers }, names: readonly string[]): Headers {
  const result = new Headers();
  for (const name of names) { const value = source.headers.get(name); if (value !== null) result.set(name, value); }
  return result;
}
function upstream(request: Request, origin: string | undefined): URL | null {
  if (!origin) return null;
  try {
    const base = new URL(origin);
    const input = new URL(request.url);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || (base.pathname !== "/" && base.pathname !== "") || base.search || base.hash || base.origin === input.origin || !PATHS.has(input.pathname)) return null;
    const result = new URL(input.pathname, base.origin); result.search = input.search; return result;
  } catch { return null; }
}
export async function proxyShiftControl(request: Request, options: Options): Promise<Response> {
  const url = upstream(request, options.upstreamOrigin);
  if (!url) return unavailable(options.createRequestId());
  try {
    const response = await (options.fetchImpl ?? fetch)(url, { method: "POST", headers: headers(request, REQUEST_HEADERS), body: await request.arrayBuffer(), cache: "no-store", redirect: "manual", signal: request.signal });
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: headers(response, RESPONSE_HEADERS) });
  } catch {
    const requestId = options.createRequestId();
    console.error("TINDIO_BACKEND_SHIFT_CONTROL_UPSTREAM_UNAVAILABLE", { requestId });
    return unavailable(requestId);
  }
}
