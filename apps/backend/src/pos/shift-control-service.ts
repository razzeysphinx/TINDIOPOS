import { handleOwnedShiftControl, type OwnedShiftControlDependencies, type ShiftControlAction } from "./shift-control-owned.js";
import { proxyShiftControl } from "./shift-control-proxy.js";

type Options = {
  action: ShiftControlAction;
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedShiftControlDependencies;
};
function unavailable(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json({ ok: false, reason: "SHIFT_CONTROL_BACKEND_UNAVAILABLE", requestId }, { status: 503, headers: { "cache-control": "private, no-store" } });
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}
export async function serveShiftControl(request: Request, options: Options): Promise<Response> {
  const mode = options.mode ?? "owned";
  if (mode === "proxy") return proxyShiftControl(request, { upstreamOrigin: options.upstreamOrigin, createRequestId: options.createRequestId });
  if (mode !== "owned") return unavailable(options.createRequestId);
  try { return await handleOwnedShiftControl(request, options.action, options.createOwnedDependencies()); }
  catch { return unavailable(options.createRequestId); }
}
