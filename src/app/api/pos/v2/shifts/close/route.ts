import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { closeMobileShift } from "@/features/shifts/service";
import { isMobileShiftCloseUpgradeRequired } from "@/features/shifts/mobile-shift-close-compatibility";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

export async function POST(request: Request) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const context = resolved.context;
  const body = await readPosApiJson(request);
  if (!body.ok) return body.response;
  const result = await closeMobileShift({
    context,
    input: body.input,
  });

  return posApiJson(
    result,
    isMobileShiftCloseUpgradeRequired(result)
      ? 426
      : 200,
  );
}
