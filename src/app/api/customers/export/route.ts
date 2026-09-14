import { NextResponse } from "next/server";

import { getBusinessContext, hasPermission } from "@/lib/auth/dal";
import { csvExportResponse } from "@/lib/export-framework";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getBusinessContext();
  if (!context) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (!hasPermission(context, "customers.manage")) return NextResponse.json({ error: "Customer management access is required." }, { status: 403 });
  const supabase = await createClient();
  const { data, error } = await supabase.from("customers").select("full_name, email, phone, address, birthday, notes, loyalty_card_code, status").eq("organization_id", context.organization.id).order("full_name");
  if (error) return NextResponse.json({ error: "TINDIO could not export customers." }, { status: 500 });
  return csvExportResponse("customers-master", [["full_name", "email", "phone", "address", "birthday", "notes", "loyalty_card_code", "status"], ...(data ?? []).map((customer) => [customer.full_name, customer.email ?? "", customer.phone ?? "", customer.address ?? "", customer.birthday ?? "", customer.notes ?? "", customer.loyalty_card_code, customer.status])], { scope: "Organization" });
}
