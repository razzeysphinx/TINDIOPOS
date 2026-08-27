import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { parsePublicSmartMenu, PublicSmartMenuView } from "@/features/smart-menu/public-smart-menu";
import { createClient } from "@/lib/supabase/server";

const menuIdSchema = z.uuid();

export const metadata = { title: "Smart Menu" };

export default async function PublicSmartMenuPage({
  params,
}: {
  params: Promise<{ menuId: string }>;
}) {
  await connection();
  const { menuId } = await params;
  if (!menuIdSchema.safeParse(menuId).success) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_smart_menu", {
    target_menu_id: menuId,
  });
  const parsed = parsePublicSmartMenu(data);
  if (error || !parsed.success) notFound();

  return <PublicSmartMenuView menu={parsed.data} />;
}
