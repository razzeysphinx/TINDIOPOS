import "server-only";

import type {
  BusinessContext,
} from "@/lib/auth/dal";
import {
  createClient,
} from "@/lib/supabase/server";

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

  return createClient({
    headers,
  });
}
