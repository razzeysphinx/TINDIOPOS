import { z } from "zod";

export const clockInSchema = z.object({
  storeId: z.uuid(),
});
