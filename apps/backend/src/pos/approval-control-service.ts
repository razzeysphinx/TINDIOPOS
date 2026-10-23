import { handleOwnedApprovalControl, type ApprovalControlAction, type OwnedApprovalControlDependencies } from "./approval-control-owned.js";
import { proxyApprovalControl } from "./approval-control-proxy.js";

type Options = {
  action: ApprovalControlAction;
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedApprovalControlDependencies;
};
function unavailable(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json({ ok: false, reason: "APPROVAL_CONTROL_BACKEND_UNAVAILABLE", requestId }, { status: 503, headers: { "cache-control": "private, no-store" } });
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}
export async function serveApprovalControl(request: Request, options: Options): Promise<Response> {
  const mode = options.mode ?? "owned";
  if (mode === "proxy") return proxyApprovalControl(request, { upstreamOrigin: options.upstreamOrigin, createRequestId: options.createRequestId });
  if (mode !== "owned") return unavailable(options.createRequestId);
  try { return await handleOwnedApprovalControl(request, options.action, options.createOwnedDependencies()); }
  catch { return unavailable(options.createRequestId); }
}
