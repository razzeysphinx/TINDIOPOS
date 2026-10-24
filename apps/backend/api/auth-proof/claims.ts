import { serveNeonBackendAuthProof } from "../../src/auth/neon-proof-service.js";

export async function GET(request: Request): Promise<Response> {
  return serveNeonBackendAuthProof(request, {
    environment: {
      TINDIO_AUTH_PROVIDER: process.env.TINDIO_AUTH_PROVIDER,
      TINDIO_AUTH_PROOF_MODE: process.env.TINDIO_AUTH_PROOF_MODE,
      NODE_ENV: process.env.NODE_ENV,
      VERCEL: process.env.VERCEL,
      VERCEL_ENV: process.env.VERCEL_ENV,
      NEON_AUTH_BASE_URL: process.env.NEON_AUTH_BASE_URL,
      NEON_AUTH_JWKS_URL: process.env.NEON_AUTH_JWKS_URL,
    },
  });
}
