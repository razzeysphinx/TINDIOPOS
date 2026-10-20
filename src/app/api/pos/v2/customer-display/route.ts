import { NextRequest, NextResponse } from "next/server";

import {
  CUSTOMER_DISPLAY_INVALID_ERROR,
  CUSTOMER_DISPLAY_OPEN_SHIFT_DATABASE_CODE,
  CUSTOMER_DISPLAY_OPEN_SHIFT_ERROR,
  CUSTOMER_DISPLAY_PERMISSION_ERROR,
  CUSTOMER_DISPLAY_UPDATE_ERROR,
  CUSTOMER_DISPLAY_UPDATE_PERMISSIONS,
  CUSTOMER_DISPLAY_UPDATE_RPC,
  customerDisplayUpdateSchema,
} from "@tindio/contracts/customer-display";
import { hasPermission } from "@/lib/auth/dal";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";
import { createBusinessContextClient } from "@/lib/supabase/context-client";

export async function PUT(request: NextRequest) {
  const resolved = await getPosV2BusinessContext(request);

  if (!resolved.ok) return resolved.response;

  const context = resolved.context;

  if (
    !hasPermission(context, CUSTOMER_DISPLAY_UPDATE_PERMISSIONS[0])
    || !hasPermission(context, CUSTOMER_DISPLAY_UPDATE_PERMISSIONS[1])
  ) {
    return NextResponse.json({ error: CUSTOMER_DISPLAY_PERMISSION_ERROR }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = customerDisplayUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: CUSTOMER_DISPLAY_INVALID_ERROR }, { status: 400 });
  }

  const supabase = await createBusinessContextClient(context);
  const { error } = await supabase.rpc(CUSTOMER_DISPLAY_UPDATE_RPC, {
    target_organization_id: context.organization.id,
    target_session_id: parsed.data.sessionId,
    target_state: parsed.data.state,
  });

  if (error) {
    return NextResponse.json(
      {
        error: error.code === CUSTOMER_DISPLAY_OPEN_SHIFT_DATABASE_CODE
          ? CUSTOMER_DISPLAY_OPEN_SHIFT_ERROR
          : CUSTOMER_DISPLAY_UPDATE_ERROR,
      },
      { status: error.code === CUSTOMER_DISPLAY_OPEN_SHIFT_DATABASE_CODE ? 403 : 500 },
    );
  }

  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
