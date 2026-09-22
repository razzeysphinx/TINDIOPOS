import "server-only";

import { NextResponse } from "next/server";

export const POS_API_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

export function posApiJson(
  body: unknown,
  status = 200,
) {
  return NextResponse.json(body, {
    status,
    headers: POS_API_NO_STORE_HEADERS,
  });
}

export async function readPosApiJson(
  request: Request,
): Promise<
  | { ok: true; input: unknown }
  | { ok: false; response: NextResponse }
> {
  try {
    return {
      ok: true,
      input: await request.json(),
    };
  } catch {
    return {
      ok: false,
      response: posApiJson(
        {
          ok: false,
          message: "The request data is invalid.",
        },
        400,
      ),
    };
  }
}
