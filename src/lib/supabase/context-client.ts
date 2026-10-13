import "server-only";

import type {
  BusinessContext,
} from "@/lib/auth/dal";
import {
  createClient,
} from "@/lib/supabase/server";
import {
  createPosV2DatabaseClient,
} from "@/lib/supabase/pos-v2-database-client";

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
    const match =
      /^Bearer ([^\s]+)$/i.exec(
        headers.Authorization.trim(),
      );

    if (match?.[1]) {
      return createPosV2DatabaseClient(
        match[1],
        { headers },
      );
    }
  }

  return createClient({
    headers,
  });
}
