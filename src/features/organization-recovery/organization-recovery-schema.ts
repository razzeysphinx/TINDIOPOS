import { z } from "zod";

export const organizationIdSchema = z.string().uuid();

export const recoveryDrillInputSchema = z.object({
  organizationId: z.string().uuid(),
  drillType: z.enum(["EXPORT_REVIEW", "LOCAL_RESTORE", "SUPABASE_RESTORE_OR_CLONE"]),
  outcome: z.enum(["PASSED", "FAILED"]),
  recoveryPointAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(0).max(10080),
  notes: z.string().trim().min(10).max(1000),
});
