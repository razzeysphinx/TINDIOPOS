import { approveManagerApproval } from "@/features/approvals/service";
import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { getPosApiBusinessContext } from "@/lib/auth/pos-api-context";

export async function POST(request: Request, { params }: { params: Promise<{ approvalRequestId: string }> }) {
  const context = await getPosApiBusinessContext(request);
  if (!context) return posApiJson({ ok: false, message: "Sign in is required." }, 401);
  const body = await readPosApiJson(request);
  if (!body.ok) return body.response;
  const input = { ...(body.input && typeof body.input === "object" ? body.input : {}), approvalRequestId: (await params).approvalRequestId };
  return posApiJson(await approveManagerApproval(context, input));
}
