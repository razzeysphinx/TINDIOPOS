import {
  posUuidSchema as receiptIdSchema,
} from "@/contracts/pos";
import { loadPosReceiptDetail } from "@/features/pos/data";
import { posApiJson } from "@/features/pos/pos-api-response";
import { hasPermission } from "@/lib/auth/dal";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ receiptId: string }> },
) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const context = resolved.context;
  if (!["pos.access", "sales.create", "receipts.view"].every((permission) => hasPermission(context, permission))) {
    return posApiJson({ ok: false, message: "Receipt access is not permitted." }, 403);
  }
  const parsed = receiptIdSchema.safeParse((await params).receiptId);
  if (!parsed.success) return posApiJson({ ok: false, message: "This receipt is invalid." }, 400);
  const receipt = await loadPosReceiptDetail(context, parsed.data);
  return receipt ? posApiJson(receipt) : posApiJson({ ok: false, message: "This receipt is unavailable." }, 404);
}
