/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getBusinessContext, hasPermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ product: z.string().uuid(), store: z.string().uuid() });
export async function GET(request: NextRequest) {
  const context = await getBusinessContext();
  if (!context) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (!hasPermission(context, "sales.create")) return NextResponse.json({ error: "POS access is not permitted." }, { status: 403 });
  const parsed = schema.safeParse({ product: request.nextUrl.searchParams.get("product"), store: request.nextUrl.searchParams.get("store") });
  if (!parsed.success || !context.storeIds.includes(parsed.data.store)) return NextResponse.json({ error: "The requested product is unavailable." }, { status: 400 });
  const supabase = await createClient();
  const database = supabase as unknown as { rpc: (name: string, args: unknown) => Promise<any> };
  const { data, error } = await database.rpc("get_pos_product_modifiers", {
    target_organization_id: context.organization.id,
    target_store_id: parsed.data.store,
    target_product_id: parsed.data.product,
  });
  if (error) return NextResponse.json({ error: "Modifiers could not be loaded." }, { status: 500 });
  return NextResponse.json({ groups: (data ?? []).map((group: any) => ({ id: group.group_id, name: group.group_name, minSelections: group.min_selections, maxSelections: group.max_selections, options: (group.options ?? []).map((option: any) => ({ id: option.id, name: option.name, priceMinor: option.price_minor })) })) });
}
