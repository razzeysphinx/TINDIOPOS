import { NextResponse } from "next/server";

import { getBusinessContext, hasPermission } from "@/lib/auth/dal";
import { csvExportResponse } from "@/lib/export-framework";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getBusinessContext();
  if (!context) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (!context.features.inventory || !hasPermission(context, "inventory.manage")) return NextResponse.json({ error: "Inventory management access is required." }, { status: 403 });
  const supabase = await createClient();
  const { data, error } = await supabase.from("suppliers").select("name, contact_name, email, phone, address, notes, lead_time_days, is_active").eq("organization_id", context.organization.id).order("name");
  if (error) return NextResponse.json({ error: "TINDIO could not export suppliers." }, { status: 500 });
  return csvExportResponse("suppliers-master", [["name", "contact_name", "email", "phone", "address", "notes", "lead_time_days", "is_active"], ...(data ?? []).map((supplier) => [supplier.name, supplier.contact_name ?? "", supplier.email ?? "", supplier.phone ?? "", supplier.address ?? "", supplier.notes ?? "", supplier.lead_time_days, supplier.is_active ? "yes" : "no"])], { scope: "Organization" });
}
