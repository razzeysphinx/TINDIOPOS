import { loadManagerApprovalStatus } from "@/features/approvals/service";
import { posApiJson } from "@/features/pos/pos-api-response";
import { getPosApiBusinessContext } from "@/lib/auth/pos-api-context";

export async function GET(request: Request, { params }: { params: Promise<{ approvalRequestId: string }> }) {
  const context = await getPosApiBusinessContext(request);
  if (!context) return posApiJson({ ok: false, message: "Sign in is required." }, 401);
  return posApiJson(await loadManagerApprovalStatus(context, { approvalRequestId: (await params).approvalRequestId }));
}
