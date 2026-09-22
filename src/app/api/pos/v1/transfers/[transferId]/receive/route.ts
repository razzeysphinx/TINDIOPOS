import {
  posUuidSchema as idSchema,
} from "@/contracts/pos-v1";
import { receivePosStockTransfer } from "@/features/inventory/pos-transfer-service";
import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { getPosApiBusinessContext } from "@/lib/auth/pos-api-context";

export async function POST(request: Request, { params }: { params: Promise<{ transferId: string }> }) {
  const context = await getPosApiBusinessContext(request);
  if (!context) return posApiJson({ ok: false, message: "Sign in is required." }, 401);
  const id = idSchema.safeParse((await params).transferId);
  if (!id.success) return posApiJson({ ok: false, message: "This transfer is invalid." }, 400);
  const body = await readPosApiJson(request);
  if (!body.ok) return body.response;
  const input = { ...(body.input && typeof body.input === "object" ? body.input : {}), stockTransferId: id.data };
  return posApiJson(await receivePosStockTransfer({ context, input }));
}
