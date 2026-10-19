import { createBackendHealthResponse } from "../src/health.js";

export function GET(): Response {
  return createBackendHealthResponse();
}
