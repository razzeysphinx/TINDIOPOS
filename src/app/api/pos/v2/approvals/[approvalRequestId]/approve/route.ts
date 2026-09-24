import { approveManagerApproval } from "@/features/approvals/service";
import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

export async function POST(request: Request, { params }: { params: Promise<{ approvalRequestId: string }> }) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const context = resolved.context;
  const body = await readPosApiJson(request);
  if (!body.ok) return body.response;
  const input = { ...(body.input && typeof body.input === "object" ? body.input : {}), approvalRequestId: (await params).approvalRequestId };
  return posApiJson(await approveManagerApproval(context, input));
}
