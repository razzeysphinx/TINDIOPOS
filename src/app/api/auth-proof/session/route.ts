import { NextResponse } from "next/server";

import {
  createNeonWebProofAuth,
  NeonWebProofConfigurationError,
} from "@/lib/auth/neon-web-proof";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const auth = createNeonWebProofAuth();
    const { data, error } = await auth.getSession();

    if (error || !data?.user) {
      return NextResponse.json(
        { user: null },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        user: {
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof NeonWebProofConfigurationError) {
      return NextResponse.json({ user: null }, { status: 404 });
    }
    throw error;
  }
}
