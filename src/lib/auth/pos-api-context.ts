import "server-only";

import { z } from "zod";

import {
  getBusinessContext,
  loadBusinessContext,
  resolveVerifiedUser,
  type BusinessContext,
} from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const TINDIO_ORGANIZATION_HEADER =
  "x-tindio-organization-id";

const organizationIdSchema = z.uuid();

const MAX_BEARER_TOKEN_LENGTH = 16_384;

type PosApiAuthentication =
  | {
      kind: "none";
    }
  | {
      kind: "invalid";
    }
  | {
      kind: "bearer";
      token: string;
      authorizationHeader: string;
    };

function parsePosApiAuthentication(
  request: Request,
): PosApiAuthentication {
  const authorization =
    request.headers.get("authorization");

  if (authorization === null) {
    return {
      kind: "none",
    };
  }

  const match =
    /^Bearer ([^\s]+)$/i.exec(
      authorization.trim(),
    );

  if (!match) {
    return {
      kind: "invalid",
    };
  }

  const token = match[1];

  if (
    token.length === 0
    || token.length > MAX_BEARER_TOKEN_LENGTH
    || token.split(".").length !== 3
  ) {
    return {
      kind: "invalid",
    };
  }

  return {
    kind: "bearer",
    token,
    authorizationHeader:
      `Bearer ${token}`,
  };
}

export async function getPosApiBusinessContext(
  request: Request,
): Promise<BusinessContext | null> {
  const authentication =
    parsePosApiAuthentication(request);

  if (authentication.kind === "none") {
    return getBusinessContext();
  }

  if (authentication.kind === "invalid") {
    return null;
  }

  const supabase = await createClient({
    headers: {
      Authorization:
        authentication.authorizationHeader,
    },
  });

  const user = await resolveVerifiedUser(
    supabase,
    authentication.token,
  );

  if (!user) {
    return null;
  }

  const requestedOrganizationHeader =
    request.headers.get(
      TINDIO_ORGANIZATION_HEADER,
    );

  const parsedOrganizationId =
    requestedOrganizationHeader === null
      ? null
      : organizationIdSchema.safeParse(
          requestedOrganizationHeader,
        );

  if (
    parsedOrganizationId
    && !parsedOrganizationId.success
  ) {
    return null;
  }

  const requestedOrganizationId =
    parsedOrganizationId?.success
      ? parsedOrganizationId.data
      : null;

  return loadBusinessContext({
    supabase,
    user,
    requestedOrganizationId,
    strictRequestedOrganization:
      requestedOrganizationHeader !== null,
    requestAuth: {
      transport: "bearer",
      authorizationHeader:
        authentication.authorizationHeader,
    },
  });
}
