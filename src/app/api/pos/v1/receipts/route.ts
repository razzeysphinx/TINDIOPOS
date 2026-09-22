import {
  posReceiptSearchQuerySchema as querySchema,
  type PosReceiptListResponse,
} from "@/contracts/pos-v1";
import { loadPosReceiptHistory } from "@/features/pos/data";
import { posApiJson } from "@/features/pos/pos-api-response";
import { hasPermission } from "@/lib/auth/dal";
import { getPosApiBusinessContext } from "@/lib/auth/pos-api-context";

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
  const response:
    PosReceiptListResponse = {
      receipts,
      hasMore:
        receipts.length === 25,
    };

  return posApiJson(response);
}
