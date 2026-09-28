import "react-native-url-polyfill/auto";
import type { PosBootstrapV2CoreResponse, PosCloseShiftV2Response, PosDeviceBinding, PosDeviceCredential, PosDeviceValidationResponse, PosLiveV2Response, PosOpenShiftV2Response } from "../../../../src/contracts/pos";
import { mobileEnvironment } from "./env";
import { supabase } from "./supabase";

const ORGANIZATION_HEADER = "x-tindio-organization-id";
const STORE_HEADER = "x-tindio-store-id";
const REGISTER_HEADER = "x-tindio-register-id";
export class TindioApiError extends Error {
  constructor(message: string, readonly status: number, readonly reason: string, readonly requestId: string | null) { super(message); this.name = "TindioApiError"; }
}
const endpoint = (pathname: string) => new URL(pathname, `${mobileEnvironment.tindioApiUrl}/`).toString();
async function token(refresh: boolean) {
  const result = refresh ? await supabase.auth.refreshSession() : await supabase.auth.getSession();
  if (result.error || !result.data.session) throw new TindioApiError("Sign in is required.", 401, "AUTH_REQUIRED", null);
  return result.data.session.access_token;
}
async function request(pathname: string, { organizationId, init = {} }: { organizationId?: string; init?: RequestInit } = {}) {
  const headers = new Headers({ Accept: "application/json", Authorization: `Bearer ${await token(false)}` });
  if (organizationId) headers.set(ORGANIZATION_HEADER, organizationId);
  for (const [key, value] of new Headers(init.headers).entries()) headers.set(key, value);
  let response = await fetch(endpoint(pathname), { ...init, method: init.method ?? "GET", headers });
  if (response.status === 401) { headers.set("Authorization", `Bearer ${await token(true)}`); response = await fetch(endpoint(pathname), { ...init, method: init.method ?? "GET", headers }); }
  if (!response.ok) throw new TindioApiError(`HTTP_${response.status}`, response.status, `HTTP_${response.status}`, response.headers.get("x-tindio-request-id"));
  return response;
}
export async function fetchPosV2Core(organizationId?: string) { return (await request("/api/pos/v2/bootstrap", { organizationId })).json() as Promise<PosBootstrapV2CoreResponse>; }
export async function enrollPosV2Device(organizationId: string, input: PosDeviceCredential & { storeId: string; registerId: string; name: string }) { return (await request("/api/pos/v2/device/enroll", { organizationId, init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } })).json() as Promise<{ ok: true; device: PosDeviceBinding }>; }
export async function validatePosV2Device(organizationId: string, credential: PosDeviceCredential) { return (await request("/api/pos/v2/device", { organizationId, init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId, device: credential }) } })).json() as Promise<PosDeviceValidationResponse>; }
export async function fetchPosV2Live(organizationId: string, binding: PosDeviceBinding) { return (await request("/api/pos/v2/live", { organizationId, init: { headers: { [STORE_HEADER]: binding.storeId, [REGISTER_HEADER]: binding.registerId } } })).json() as Promise<PosLiveV2Response>; }
export async function openPosV2Shift(organizationId: string, binding: PosDeviceBinding, credential: PosDeviceCredential, input: { openingCash: string; openingNote?: string }) { return (await request("/api/pos/v2/shifts/open", { organizationId, init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId: binding.storeId, registerId: binding.registerId, ...input, device: credential }) } })).json() as Promise<PosOpenShiftV2Response>; }
export async function closePosV2Shift(organizationId: string, input: { shiftId: string; countedCash: string; closingNote?: string }) { return (await request("/api/pos/v2/shifts/close", { organizationId, init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } })).json() as Promise<PosCloseShiftV2Response>; }
