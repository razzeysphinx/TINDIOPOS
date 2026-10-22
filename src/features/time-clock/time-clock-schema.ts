import { z } from "zod";

export { clockInSchema, clockOutSchema } from "@tindio/contracts/attendance-mutation";

export const attendanceStoreSchema = z.object({ storeId: z.uuid() });
