import {
  NextResponse,
  type NextRequest,
} from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

const maintenancePath = "/maintenance";

function isCutoverFrozen() {
  const mode =
    process.env
      .TINDIO_CUTOVER_MODE
    ?? "normal";

  if (
    mode !== "normal"
    && mode !== "freeze"
  ) {
    throw new Error(
      "TINDIO_CUTOVER_MODE must be either normal or freeze.",
    );
  }

  return mode === "freeze";
}

function hasCutoverBypass(
  request: NextRequest,
) {
  const expected =
    process.env
      .TINDIO_CUTOVER_BYPASS_SECRET;

  return Boolean(
    expected
    && request.headers.get(
      "x-tindio-cutover-bypass",
    ) === expected,
  );
}

function maintenanceApiResponse() {
  return NextResponse.json(
    {
      ok: false,
      code: "CUTOVER_MAINTENANCE",
      message:
        "TINDIO is temporarily unavailable during database maintenance.",
      retryable: true,
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "60",
      },
    },
  );
}

export async function proxy(request: NextRequest) {
  const pathname =
    request.nextUrl.pathname;

  if (
    isCutoverFrozen()
    && pathname !== maintenancePath
    && !hasCutoverBypass(request)
  ) {
    if (pathname.startsWith("/api/")) {
      return maintenanceApiResponse();
    }

    const url =
      request.nextUrl.clone();

    url.pathname = maintenancePath;
    url.search = "";

    return NextResponse.redirect(url);
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|service-worker.js|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
