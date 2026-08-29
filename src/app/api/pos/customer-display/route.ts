import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { customerDisplayStateSchema } from "@/features/customer-display/customer-display-types";
import { getBusinessContext, hasPermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

const updateSchema = z.object({
  sessionId: z.uuid(),
  state: customerDisplayStateSchema,
});

export async function PUT(request: NextRequest) {
  const context = await getBusinessContext();

  if (!context) {
    return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  }

  if (!hasPermission(context, "pos.access") || !hasPermission(context, "sales.create")) {
    return NextResponse.json({ error: "POS access is not permitted." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "The customer display update is invalid." }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_customer_display_state", {
    target_organization_id: context.organization.id,
    target_session_id: parsed.data.sessionId,
    target_state: parsed.data.state,
  });

  if (error) {
    return NextResponse.json(
      { error: error.code === "42501" ? "An open shift is required for this display." : "The display could not be updated." },
      { status: error.code === "42501" ? 403 : 500 },
    );
  }

  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
