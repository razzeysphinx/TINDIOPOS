import { z } from "zod";

import { receivePosStockRequest } from "@/features/inventory/pos-transfer-service";
import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { getPosApiBusinessContext } from "@/lib/auth/pos-api-context";

const idSchema = z.uuid();

export async function POST(request: Request, { params }: { params: Promise<{ stockRequestId: string }> }) {
  const context = await getPosApiBusinessContext(request);
  if (!context) return posApiJson({ ok: false, message: "Sign in is required." }, 401);
  const id = idSchema.safeParse((await params).stockRequestId);
  if (!id.success) return posApiJson({ ok: false, message: "This stock request is invalid." }, 400);
  const body = await readPosApiJson(request);
  if (!body.ok) return body.response;
  const input = { ...(body.input && typeof body.input === "object" ? body.input : {}), stockRequestId: id.data };
  return posApiJson(await receivePosStockRequest({ context, input }));
}
