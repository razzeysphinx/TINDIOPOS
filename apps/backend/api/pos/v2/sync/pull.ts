import { randomUUID } from "node:crypto";
import { createOwnedDeviceSyncDependencies } from "../../../../src/pos/device-sync-runtime.js";
import { serveDeviceSync } from "../../../../src/pos/device-sync-service.js";
export async function POST(request: Request): Promise<Response> { return serveDeviceSync(request, { action: "pull", mode: process.env.TINDIO_DEVICE_SYNC_MODE, upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN, createRequestId: randomUUID, createOwnedDependencies: () => createOwnedDeviceSyncDependencies({ environment: process.env }) }); }
