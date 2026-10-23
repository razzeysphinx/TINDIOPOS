import { handleOwnedDeviceSync, type DeviceSyncAction, type OwnedDeviceSyncDependencies } from "./device-sync-owned.js";
import { proxyDeviceSync } from "./device-sync-proxy.js";

type Options = {
  action: DeviceSyncAction;
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedDeviceSyncDependencies;
};
function unavailable(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json({ ok: false, reason: "DEVICE_SYNC_BACKEND_UNAVAILABLE", requestId }, { status: 503, headers: { "cache-control": "private, no-store" } });
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}
export async function serveDeviceSync(request: Request, options: Options): Promise<Response> {
  const mode = options.mode ?? "owned";
  if (mode === "proxy") return proxyDeviceSync(request, { upstreamOrigin: options.upstreamOrigin, createRequestId: options.createRequestId });
  if (mode !== "owned") return unavailable(options.createRequestId);
  try { return await handleOwnedDeviceSync(request, options.action, options.createOwnedDependencies()); }
  catch { return unavailable(options.createRequestId); }
}
