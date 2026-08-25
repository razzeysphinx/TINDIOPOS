/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { hasPermission, getBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import type { PosCatalogResponse } from "@/features/pos/pos-types";
import { mapPosCatalogItems } from "@/features/pos/data";

const catalogRequestSchema = z.object({
  store: z.string().uuid(),
  query: z.string().trim().max(100).optional().default(""),
  category: z.string().uuid().optional(),
  offset: z.coerce.number().int().min(0).max(10_000).optional().default(0),
  limit: z.coerce.number().int().min(1).max(24).optional().default(24),
});

export async function GET(request: NextRequest) {
  const context = await getBusinessContext();

  if (!context) {
    return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  }

  if (!hasPermission(context, "sales.create")) {
    return NextResponse.json({ error: "POS access is not permitted." }, { status: 403 });
  }

  const parsed = catalogRequestSchema.safeParse({
    store: request.nextUrl.searchParams.get("store"),
    query: request.nextUrl.searchParams.get("query") ?? "",
    category: request.nextUrl.searchParams.get("category") ?? undefined,
    offset: request.nextUrl.searchParams.get("offset") ?? 0,
    limit: request.nextUrl.searchParams.get("limit") ?? 24,
  });

  if (!parsed.success || !context.storeIds.includes(parsed.data.store)) {
    return NextResponse.json({ error: "The requested store is unavailable." }, { status: 400 });
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
    return NextResponse.json({ error: "The register shift could not be verified." }, { status: 500 });
  }

  if (!activeShift) {
    return NextResponse.json(
      { error: "No active register shift. Open a shift before using the POS catalogue." },
      { status: 403 },
    );
  }

  const { data, error } = await supabase.rpc("search_pos_catalog", {
    target_organization_id: context.organization.id,
    target_store_id: parsed.data.store,
    target_query: parsed.data.query || undefined,
    target_category_id: parsed.data.category,
    target_offset: parsed.data.offset,
    target_limit: parsed.data.limit,
  });

  if (error) {
    return NextResponse.json({ error: "The POS catalogue could not be loaded." }, { status: 500 });
  }

  const database = supabase as unknown as { from: (table: string) => any };
  const productIds = [...new Set((data ?? []).map((item) => item.product_id))];
  const { data: modifierAssignments } = productIds.length > 0
    ? await database.from("product_modifier_groups").select("product_id").eq("organization_id", context.organization.id).in("product_id", productIds)
    : { data: [] };
  const modifierProductIds = new Set<string>((modifierAssignments ?? []).map((assignment: any) => assignment.product_id));

  const items = mapPosCatalogItems(data ?? [], modifierProductIds, true);
  const response: PosCatalogResponse = {
    items,
    hasMore: items.length === parsed.data.limit,
  };

  return NextResponse.json(response);
}
