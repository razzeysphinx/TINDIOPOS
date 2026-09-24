import {
  posUuidSchema as idSchema,
} from "@/contracts/pos";
import { receivePosStockTransfer } from "@/features/inventory/pos-transfer-service";
import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

export async function POST(request: Request, { params }: { params: Promise<{ transferId: string }> }) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const context = resolved.context;
  const id = idSchema.safeParse((await params).transferId);
  if (!id.success) return posApiJson({ ok: false, message: "This transfer is invalid." }, 400);
  const body = await readPosApiJson(request);
  if (!body.ok) return body.response;
  const input = { ...(body.input && typeof body.input === "object" ? body.input : {}), stockTransferId: id.data };
  return posApiJson(await receivePosStockTransfer({ context, input }));
}
