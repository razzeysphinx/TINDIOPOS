import {
  posReceiptSearchQuerySchema as querySchema,
  type PosReceiptListResponse,
} from "@/contracts/pos";
import { loadPosReceiptHistory } from "@/features/pos/data";
import { posApiJson } from "@/features/pos/pos-api-response";
import { hasPermission } from "@/lib/auth/dal";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

export async function GET(request: Request) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const context = resolved.context;
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
  const response:
    PosReceiptListResponse = {
      receipts,
      hasMore:
        receipts.length === 25,
    };

  return posApiJson(response);
}
