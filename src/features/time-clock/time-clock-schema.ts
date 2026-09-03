import { z } from "zod";

export const clockInSchema = z.object({
  storeId: z.uuid(),
  employeeId: z.uuid(),
  pin: z.string().regex(/^\d{6,12}$/, "Use a 6–12 digit PIN."),
  requestId: z.uuid(),
});

export const clockOutSchema = z.object({
  employeeId: z.uuid(),
  pin: z.string().regex(/^\d{6,12}$/, "Use a 6–12 digit PIN."),
  requestId: z.uuid(),
});

export const attendanceStoreSchema = z.object({ storeId: z.uuid() });
