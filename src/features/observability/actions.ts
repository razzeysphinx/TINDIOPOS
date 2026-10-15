"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({ alertId: z.uuid() });

export async function acknowledgeOperationalAlertAction(formData: FormData) {
  const context = await requireBackOfficePermission("devices.manage");
  if (!hasPermission(context, "devices.manage")) return;
  const parsed = inputSchema.safeParse({ alertId: formData.get("alertId") });
  if (!parsed.success) return;
  const database = await createClient() as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>;
  };
  const result = await database.rpc("acknowledge_pos_operational_alert", {
    target_organization_id: context.organization.id,
    target_alert_id: parsed.data.alertId,
  });
  if (result.error) throw new Error("TINDIO could not acknowledge this operational alert.");
  revalidatePath("/back-office/observability");
}
