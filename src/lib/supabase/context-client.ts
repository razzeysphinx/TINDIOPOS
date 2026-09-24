import "server-only";

import type {
  BusinessContext,
} from "@/lib/auth/dal";
import {
  createAuthenticatedDatabaseClient,
} from "@/lib/supabase/authenticated-database-client";

export async function createBusinessContextClient(
  context: Pick<
    BusinessContext,
    "requestAuth"
  >,
  options: {
    headers?: Record<string, string>;
  } = {},
) {
  const headers =
    Object.fromEntries(
      Object.entries(
        options.headers ?? {},
      ).filter(
        ([name]) =>
          name.toLowerCase()
          !== "authorization",
      ),
    );

  if (
    context.requestAuth.transport
      === "bearer"
    || context.requestAuth.transport
      === "cookie"
  ) {
    headers.Authorization =
      context.requestAuth
        .authorizationHeader;
  }

  return createAuthenticatedDatabaseClient(
    context.requestAuth
      .authorizationHeader,
    {
      headers,
    },
  );
}
