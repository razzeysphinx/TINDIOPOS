import { randomUUID } from "node:crypto";
import { createOwnedApprovalControlDependencies } from "../../../../../src/pos/approval-control-runtime.js";
import { serveApprovalControl } from "../../../../../src/pos/approval-control-service.js";

export async function POST(request: Request): Promise<Response> {
  return serveApprovalControl(request, {
    action: "approve", mode: process.env.TINDIO_APPROVAL_CONTROL_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN, createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedApprovalControlDependencies({ environment: process.env }),
  });
}
