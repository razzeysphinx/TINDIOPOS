import { NextResponse } from "next/server";

import { completeCheckout } from "@/features/checkout/checkout-service";
import { getBusinessContext } from "@/lib/auth/dal";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  let input: unknown;

  try {
    input = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "The checkout data is invalid. Return to the cart and try again.",
        retryable: false,
      },
      { status: 400, headers: noStoreHeaders },
    );
  }

  try {
    const context = await getBusinessContext();
    if (!context) {
      return NextResponse.json(
        {
          ok: false,
          message: "Your sign-in has expired. Sign in again before completing this sale.",
          retryable: true,
        },
        { status: 401, headers: noStoreHeaders },
      );
    }

    const result = await completeCheckout(context, input);
    return NextResponse.json(result, {
      status: result.ok ? 200 : result.retryable ? 503 : 409,
      headers: noStoreHeaders,
    });
  } catch (error) {
    // Never report an unverified checkout as "not charged". The checkout RPC is
    // atomic, but a transport failure can happen after it has committed.
    console.error("TINDIO online checkout request failed", error);
    return NextResponse.json(
      {
        ok: false,
        message:
          "TINDIO could not confirm this sale. Check Recent receipts before retrying.",
        retryable: true,
      },
      { status: 500, headers: noStoreHeaders },
    );
  }
}
