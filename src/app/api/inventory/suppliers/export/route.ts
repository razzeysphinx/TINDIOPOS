import { NextResponse } from "next/server";

import { getBusinessContext, hasPermission } from "@/lib/auth/dal";
import { csvRows } from "@/lib/csv";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getBusinessContext();
  if (!context) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (!context.features.inventory || !hasPermission(context, "inventory.manage")) return NextResponse.json({ error: "Inventory management access is required." }, { status: 403 });
  const supabase = await createClient();
  const { data, error } = await supabase.from("suppliers").select("name, contact_name, email, phone, address, notes, lead_time_days, is_active").eq("organization_id", context.organization.id).order("name");
  if (error) return NextResponse.json({ error: "TINDIO could not export suppliers." }, { status: 500 });
  const body = csvRows([["name", "contact_name", "email", "phone", "address", "notes", "lead_time_days", "is_active"], ...(data ?? []).map((supplier) => [supplier.name, supplier.contact_name ?? "", supplier.email ?? "", supplier.phone ?? "", supplier.address ?? "", supplier.notes ?? "", supplier.lead_time_days, supplier.is_active ? "yes" : "no"])]);
  return new Response(body, { headers: { "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename="tindio-suppliers-${new Date().toISOString().slice(0, 10)}.csv"`, "Content-Type": "text/csv; charset=utf-8" } });
}
