import { z } from "zod";

export const provisionSchema = z.object({ registerId: z.uuid() });
