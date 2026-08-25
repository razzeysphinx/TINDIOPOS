import { z } from "zod";

export const organizationIdSchema = z.string().uuid();

export const lifecycleInputSchema = z.object({
  organizationId: z.string().uuid(),
  action: z.enum(["SUSPEND", "RESUME", "REQUEST_ARCHIVE", "CANCEL_ARCHIVE", "ARCHIVE"]),
  reason: z.string().trim().max(500).optional(),
});
