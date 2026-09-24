import { loadManagerApprovalStatus } from "@/features/approvals/service";
import { posApiJson } from "@/features/pos/pos-api-response";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

export async function GET(request: Request, { params }: { params: Promise<{ approvalRequestId: string }> }) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const context = resolved.context;
  return posApiJson(await loadManagerApprovalStatus(context, { approvalRequestId: (await params).approvalRequestId }));
}
