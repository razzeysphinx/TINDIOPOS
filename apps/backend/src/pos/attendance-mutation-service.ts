import {
  handleOwnedAttendanceMutation,
  type AttendanceMutationAction,
  type OwnedAttendanceMutationDependencies,
} from "./attendance-mutation-owned.js";
import { proxyAttendanceMutation } from "./attendance-mutation-proxy.js";

type AttendanceMutationServiceOptions = {
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedAttendanceMutationDependencies;
};

function configurationFailure(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json(
    { ok: false, reason: "ATTENDANCE_MUTATION_BACKEND_UNAVAILABLE", requestId },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

export async function serveAttendanceMutation(
  request: Request,
  action: AttendanceMutationAction,
  options: AttendanceMutationServiceOptions,
): Promise<Response> {
  const mode = options.mode ?? "owned";
  if (mode === "proxy") {
    return proxyAttendanceMutation(request, {
      upstreamOrigin: options.upstreamOrigin,
      createRequestId: options.createRequestId,
    });
  }
  if (mode !== "owned") return configurationFailure(options.createRequestId);
  try {
    return await handleOwnedAttendanceMutation(request, action, options.createOwnedDependencies());
  } catch {
    return configurationFailure(options.createRequestId);
  }
}
