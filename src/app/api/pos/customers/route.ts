import { NextResponse } from "next/server";
import { z } from "zod";

import { getBusinessContext, hasPermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  store: z.uuid(),
});

export async function GET(request: Request) {
  const context = await getBusinessContext();
  if (!context || !hasPermission(context, "pos.access") || !hasPermission(context, "sales.create")) {
    return NextResponse.json({ error: "POS access is not permitted." }, { status: 403 });
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsed.success || !context.storeIds.includes(parsed.data.store)) {
    return NextResponse.json({ error: "Choose an assigned store." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: activeShift, error: shiftError } = await supabase
    .from("shifts")
    .select("id")
    .eq("organization_id", context.organization.id)
    .eq("store_id", parsed.data.store)
    .eq("opened_by_employee_id", context.employee.id)
    .eq("status", "open")
    .maybeSingle();

  if (shiftError) {
    return NextResponse.json(
      { error: "The active register shift could not be verified." },
      { status: 500 },
    );
  }

  if (!activeShift) {
    return NextResponse.json(
      { error: "Open a register shift before looking up customers." },
      { status: 403 },
    );
  }

  const { data, error } = await supabase.rpc("search_pos_customers", {
    target_organization_id: context.organization.id,
    target_store_id: parsed.data.store,
    target_query: parsed.data.q || "",
    target_limit: 8,
  });

  if (error) {
    return NextResponse.json(
      { error: "Customers could not be loaded for this sale." },
      { status: error.code === "42501" ? 403 : 500 },
    );
  }

  return NextResponse.json({
    customers: (data ?? []).map((customer) => ({
      id: customer.customer_id,
      customerNumber: customer.customer_number,
      loyaltyCardCode: customer.loyalty_card_code,
      fullName: customer.full_name,
      phone: customer.phone,
      email: customer.email,
      loyaltyPoints: customer.loyalty_points,
    })),
  });
}
