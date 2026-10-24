import { handleAuthProxyRequest } from "@neondatabase/auth/server";
import { type NextRequest, NextResponse } from "next/server";

import {
  getNeonWebProofConfiguration,
  NeonWebProofConfigurationError,
} from "@/lib/auth/neon-web-proof";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const configuration = getNeonWebProofConfiguration();
    const sessionResponse = await handleAuthProxyRequest({
      request,
      path: "get-session",
      baseUrl: configuration.baseUrl,
      cookieSecret: configuration.cookieSecret,
      sameSite: "strict",
      sessionDataTtl: configuration.sessionDataTtl,
    });
    const data = sessionResponse.ok
      ? await sessionResponse.json()
      : null;

    const response = !data?.user
      ? NextResponse.json(
        { user: null },
        { headers: { "Cache-Control": "no-store" } },
      )
      : NextResponse.json(
        {
          user: {
            id: data.user.id,
            email: data.user.email,
            emailVerified: data.user.emailVerified,
            name: data.user.name,
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      );

    for (const cookie of sessionResponse.headers.getSetCookie()) {
      response.headers.append("Set-Cookie", cookie);
    }
    return response;
  } catch (error) {
    if (error instanceof NeonWebProofConfigurationError) {
      return NextResponse.json({ user: null }, { status: 404 });
    }
    throw error;
  }
}
