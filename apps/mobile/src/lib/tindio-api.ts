import "react-native-url-polyfill/auto";
import type { PosBootstrapV2CoreResponse } from "../../../../src/contracts/pos";
import { mobileEnvironment } from "./env";
import { supabase } from "./supabase";

const ORGANIZATION_HEADER = "x-tindio-organization-id";
export class TindioApiError extends Error {
  constructor(message: string, readonly status: number, readonly reason: string, readonly requestId: string | null) { super(message); this.name = "TindioApiError"; }
}
const endpoint = (pathname: string) => new URL(pathname, `${mobileEnvironment.tindioApiUrl}/`).toString();
async function token(refresh: boolean) {
  const result = refresh ? await supabase.auth.refreshSession() : await supabase.auth.getSession();
  if (result.error || !result.data.session) throw new TindioApiError("Sign in is required.", 401, "AUTH_REQUIRED", null);
  return result.data.session.access_token;
}
async function request(pathname: string, organizationId?: string) {
  const headers = new Headers({ Accept: "application/json", Authorization: `Bearer ${await token(false)}` });
  if (organizationId) headers.set(ORGANIZATION_HEADER, organizationId);
  let response = await fetch(endpoint(pathname), { method: "GET", headers });
  if (response.status === 401) { headers.set("Authorization", `Bearer ${await token(true)}`); response = await fetch(endpoint(pathname), { method: "GET", headers }); }
  if (!response.ok) throw new TindioApiError(`HTTP_${response.status}`, response.status, `HTTP_${response.status}`, response.headers.get("x-tindio-request-id"));
  return response;
}
export async function fetchPosV2Core(organizationId?: string) { return (await request("/api/pos/v2/bootstrap", organizationId)).json() as Promise<PosBootstrapV2CoreResponse>; }
