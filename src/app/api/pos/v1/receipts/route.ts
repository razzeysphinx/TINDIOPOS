import { z } from "zod";

import { loadPosReceiptHistory } from "@/features/pos/data";
import { posApiJson } from "@/features/pos/pos-api-response";
import { hasPermission } from "@/lib/auth/dal";
import { getPosApiBusinessContext } from "@/lib/auth/pos-api-context";

const querySchema = z.object({
  q: z.string().trim().max(100).optional().default(""),
  before: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
});

export async function GET(request: Request) {
  const context = await getPosApiBusinessContext(request);
  if (!context) return posApiJson({ ok: false, message: "Sign in is required." }, 401);
  if (!["pos.access", "sales.create", "receipts.view"].every((permission) => hasPermission(context, permission))) {
    return posApiJson({ ok: false, message: "Receipt access is not permitted." }, 403);
  }
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ q: url.searchParams.get("q") ?? "", before: url.searchParams.get("before") ?? undefined });
  if (!parsed.success) return posApiJson({ ok: false, message: "The receipt search is invalid." }, 400);
  const receipts = await loadPosReceiptHistory(context, {
    beforeReceiptNumber: parsed.data.before,
    query: parsed.data.q,
  });
  return posApiJson({ receipts, hasMore: receipts.length === 25 });
}
