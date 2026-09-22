import {
  posUuidSchema as receiptIdSchema,
} from "@/contracts/pos-v1";
import { loadPosReceiptDetail } from "@/features/pos/data";
import { posApiJson } from "@/features/pos/pos-api-response";
import { hasPermission } from "@/lib/auth/dal";
import { getPosApiBusinessContext } from "@/lib/auth/pos-api-context";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ receiptId: string }> },
) {
  const context = await getPosApiBusinessContext(request);
  if (!context) return posApiJson({ ok: false, message: "Sign in is required." }, 401);
  if (!["pos.access", "sales.create", "receipts.view"].every((permission) => hasPermission(context, permission))) {
    return posApiJson({ ok: false, message: "Receipt access is not permitted." }, 403);
  }
  const parsed = receiptIdSchema.safeParse((await params).receiptId);
  if (!parsed.success) return posApiJson({ ok: false, message: "This receipt is invalid." }, 400);
  const receipt = await loadPosReceiptDetail(context, parsed.data);
  return receipt ? posApiJson(receipt) : posApiJson({ ok: false, message: "This receipt is unavailable." }, 404);
}
