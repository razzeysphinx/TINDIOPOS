import { NextResponse, type NextRequest } from "next/server";

import {
  ensureCurrentIdentityProfile,
} from "@/lib/auth/identity-provisioning";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const requestedNext = requestUrl.searchParams.get("next");
  const next =
    requestedNext &&
    requestedNext.startsWith("/") &&
    !requestedNext.startsWith("//")
      ? requestedNext
      : "/workspace";

  if (!code) {
    return NextResponse.redirect(new URL("/auth/error", requestUrl.origin));
  }

  const supabase = await createClient();
  const {
    data,
    error,
  } =
    await supabase.auth
      .exchangeCodeForSession(
        code,
      );

  if (error) {
    return NextResponse.redirect(new URL("/auth/error", requestUrl.origin));
  }

  const provisioning =
    await ensureCurrentIdentityProfile(
      supabase,
      {
        email:
          data.user?.email,

        fullName:
          typeof data.user
            ?.user_metadata
            ?.full_name
            === "string"
            ? data.user
                .user_metadata
                .full_name
            : "",
      },
    );

  if (!provisioning.ok) {
    await supabase.auth
      .signOut();

    return NextResponse.redirect(
      new URL(
        "/auth/error",
        requestUrl.origin,
      ),
    );
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}
