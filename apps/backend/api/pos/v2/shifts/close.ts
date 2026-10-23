import { randomUUID } from "node:crypto";
import { createOwnedShiftControlDependencies } from "../../../../src/pos/shift-control-runtime.js";
import { serveShiftControl } from "../../../../src/pos/shift-control-service.js";
export async function POST(request: Request): Promise<Response> { return serveShiftControl(request, { action: "close", mode: process.env.TINDIO_SHIFT_CONTROL_MODE, upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN, createRequestId: randomUUID, createOwnedDependencies: () => createOwnedShiftControlDependencies({ environment: process.env }) }); }
