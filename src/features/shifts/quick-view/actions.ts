"use server";

import { z } from "zod";

import { loadShiftAuditReport } from "@/features/shifts/data";
import { requireBackOfficePermission } from "@/lib/auth/dal";

const shiftIdSchema = z.object({ shiftId: z.uuid() });

export type ShiftQuickViewActionResult =
  | { ok: true; data: Awaited<ReturnType<typeof loadShiftAuditReport>> }
  | { ok: false; message: string };

export async function loadShiftQuickViewAction(input: unknown): Promise<ShiftQuickViewActionResult> {
  const parsed = shiftIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "We couldn't load this shift report." };

  try {
    const context = await requireBackOfficePermission(["shifts.view_history", "settings.manage"]);
    const data = await loadShiftAuditReport(context, parsed.data.shiftId);
    return { ok: true, data };
  } catch {
    return { ok: false, message: "We couldn't load this shift report." };
  }
}
