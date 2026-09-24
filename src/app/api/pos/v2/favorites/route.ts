import { posApiJson, readPosApiJson } from "@/features/pos/pos-api-response";
import { setPosFavoriteTile } from "@/features/pos/service";
import { hasPermission } from "@/lib/auth/dal";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

export async function POST(request: Request) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const context = resolved.context;
  if (!hasPermission(context, "products.manage")) {
    return posApiJson({ ok: false, message: "Product-management permission is required to configure POS tiles." });
  }

  const body = await readPosApiJson(request);
  if (!body.ok) return body.response;
  return posApiJson(await setPosFavoriteTile({ context, input: body.input }));
}
