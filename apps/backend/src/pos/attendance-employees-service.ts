import type { OwnedAttendanceEmployeesDependencies } from "./attendance-employees-owned.js";
import { handleOwnedPosAttendanceEmployees } from "./attendance-employees-owned.js";
import { proxyPosAttendanceEmployees } from "./attendance-employees-proxy.js";

type AttendanceEmployeesServiceOptions = {
  mode: string | undefined;
  createRequestId: () => string;
  upstreamOrigin: string | undefined;
  createOwnedDependencies: () => OwnedAttendanceEmployeesDependencies;
};

function configurationFailure(createRequestId: () => string): Response {
  const requestId = createRequestId();
  const response = Response.json(
    { ok: false, reason: "ATTENDANCE_EMPLOYEES_BACKEND_UNAVAILABLE", requestId },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

export async function servePosAttendanceEmployees(
  request: Request,
  options: AttendanceEmployeesServiceOptions,
): Promise<Response> {
  const mode = options.mode ?? "owned";

  if (mode === "proxy") {
    return proxyPosAttendanceEmployees(request, {
      upstreamOrigin: options.upstreamOrigin,
      createRequestId: options.createRequestId,
    });
  }
  if (mode !== "owned") return configurationFailure(options.createRequestId);

  try {
    return await handleOwnedPosAttendanceEmployees(
      request,
      options.createOwnedDependencies(),
    );
  } catch {
    return configurationFailure(options.createRequestId);
  }
}
