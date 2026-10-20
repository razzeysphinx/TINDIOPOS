import { randomUUID } from "node:crypto";

import { createOwnedAttendanceEmployeesDependencies } from "../../../../src/pos/attendance-employees-runtime.js";
import { servePosAttendanceEmployees } from "../../../../src/pos/attendance-employees-service.js";

export async function GET(request: Request): Promise<Response> {
  return servePosAttendanceEmployees(request, {
    mode: process.env.TINDIO_ATTENDANCE_EMPLOYEES_READ_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedAttendanceEmployeesDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
      createRequestId: randomUUID,
    }),
  });
}
