export const BACKEND_HEALTH_PAYLOAD = Object.freeze({
  service: "tindio-backend",
  status: "ok",
  version: 1,
} as const);

export type BackendHealthPayload = typeof BACKEND_HEALTH_PAYLOAD;

export function createBackendHealthResponse(): Response {
  return Response.json(BACKEND_HEALTH_PAYLOAD, {
    status: 200,
    headers: {
      "cache-control": "no-store",
    },
  });
}
