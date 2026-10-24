import type { AuthTokenVerifier } from "@tindio/contracts/auth";

import {
  createBackendAuthTokenVerifier,
  type BackendAuthEnvironment,
} from "./provider.js";

type NeonProofServiceOptions = {
  environment: BackendAuthEnvironment;
  createVerifier?: () => AuthTokenVerifier;
};

const noStoreHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: noStoreHeaders,
  });
}

export async function serveNeonBackendAuthProof(
  request: Request,
  {
    environment,
    createVerifier = () => createBackendAuthTokenVerifier({ environment }),
  }: NeonProofServiceOptions,
) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed." }, 405);
  }

  let verifier: AuthTokenVerifier;
  try {
    verifier = createVerifier();
  } catch {
    return json({ error: "Not found." }, 404);
  }

  if (verifier.provider !== "neon") {
    return json({ error: "Not found." }, 404);
  }

  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    return json({ error: "Unauthorized." }, 401);
  }

  const result = await verifier.verifyAccessToken(match[1]);
  if (!result.ok) {
    return json(
      { error: "Unauthorized." },
      result.error.code === "PROVIDER_UNAVAILABLE" ? 503 : 401,
    );
  }

  return json({
    identity: {
      provider: result.value.provider,
      subject: result.value.subject,
      email: result.value.email,
      role: result.value.role,
      expiresAt: result.value.expiresAt,
    },
  }, 200);
}
