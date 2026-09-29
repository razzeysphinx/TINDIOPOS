import "react-native-url-polyfill/auto";
import type { PosBootstrapV2CoreResponse, PosCatalogV2Response, PosCloseShiftV2Response, PosCustomerSearchResponse, PosDeviceBinding, PosDeviceCredential, PosDeviceSyncCheckpoint, PosDeviceValidationResponse, PosLiveV2Response, PosModifiersV2Response, PosOpenShiftV2Response, PosReceiptListResponse, PosReferenceV2Response, ValidateCartStockActionResult, ValidateCartStockValues } from "../../../../src/contracts/pos";
import { mobileEnvironment } from "./env";
import { supabase } from "./supabase";

const ORGANIZATION_HEADER = "x-tindio-organization-id";
const STORE_HEADER = "x-tindio-store-id";
const REGISTER_HEADER = "x-tindio-register-id";
export class TindioApiError extends Error {
  constructor(message: string, readonly status: number, readonly reason: string, readonly requestId: string | null) { super(message); this.name = "TindioApiError"; }
}
export function isExplicitAuthorizationDenial(error: unknown) {
  return error instanceof TindioApiError && (error.status === 401 || error.status === 403) && error.reason.startsWith("HTTP_");
}
const endpoint = (pathname: string) => new URL(pathname, `${mobileEnvironment.tindioApiUrl}/`).toString();
async function token(refresh: boolean) {
  const result = refresh ? await supabase.auth.refreshSession() : await supabase.auth.getSession();
  if (result.error || !result.data.session) throw new TindioApiError("Sign in is required.", 401, "AUTH_REQUIRED", null);
  return result.data.session.access_token;
}
export async function requestPosV2Raw(pathname: string, { organizationId, init = {} }: { organizationId?: string; init?: RequestInit } = {}) {
  const headers = new Headers({ Accept: "application/json", Authorization: `Bearer ${await token(false)}` });
  if (organizationId) headers.set(ORGANIZATION_HEADER, organizationId);
  for (const [key, value] of new Headers(init.headers).entries()) headers.set(key, value);
  let response = await fetch(endpoint(pathname), { ...init, method: init.method ?? "GET", headers });
  if (response.status === 401) { headers.set("Authorization", `Bearer ${await token(true)}`); response = await fetch(endpoint(pathname), { ...init, method: init.method ?? "GET", headers }); }
  return response;
}
async function request(pathname: string, options: { organizationId?: string; init?: RequestInit } = {}) {
  const response = await requestPosV2Raw(pathname, options);
  if (!response.ok) throw new TindioApiError(`HTTP_${response.status}`, response.status, `HTTP_${response.status}`, response.headers.get("x-tindio-request-id"));
  return response;
}
export async function fetchPosV2Core(organizationId?: string) { return (await request("/api/pos/v2/bootstrap", { organizationId })).json() as Promise<PosBootstrapV2CoreResponse>; }
export async function enrollPosV2Device(organizationId: string, input: PosDeviceCredential & { storeId: string; registerId: string; name: string }) { return (await request("/api/pos/v2/device/enroll", { organizationId, init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } })).json() as Promise<{ ok: true; device: PosDeviceBinding }>; }
export async function validatePosV2Device(organizationId: string, credential: PosDeviceCredential) { return (await request("/api/pos/v2/device", { organizationId, init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId, device: credential }) } })).json() as Promise<PosDeviceValidationResponse>; }
export async function fetchPosV2DeviceCheckpoint(organizationId: string, credential: PosDeviceCredential) { return (await request("/api/pos/v2/sync/checkpoint", { organizationId, init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId, device: credential }) } })).json() as Promise<{ ok: true; checkpoint: PosDeviceSyncCheckpoint } | { ok: false; message: string }>; }
export async function fetchPosV2Live(organizationId: string, binding: PosDeviceBinding) { return (await request("/api/pos/v2/live", { organizationId, init: { headers: { [STORE_HEADER]: binding.storeId, [REGISTER_HEADER]: binding.registerId } } })).json() as Promise<PosLiveV2Response>; }
export async function openPosV2Shift(organizationId: string, binding: PosDeviceBinding, credential: PosDeviceCredential, input: { openingCash: string; openingNote?: string }) { return (await request("/api/pos/v2/shifts/open", { organizationId, init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId: binding.storeId, registerId: binding.registerId, ...input, device: credential }) } })).json() as Promise<PosOpenShiftV2Response>; }
export async function closePosV2Shift(organizationId: string, input: { shiftId: string; countedCash: string; closingNote?: string }) { return (await request("/api/pos/v2/shifts/close", { organizationId, init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } })).json() as Promise<PosCloseShiftV2Response>; }
export async function fetchPosV2Reference(organizationId: string) { return (await request("/api/pos/v2/reference", { organizationId })).json() as Promise<PosReferenceV2Response>; }
export async function fetchPosV2CatalogPage(organizationId: string, storeId: string, options: { offset?: number; limit?: number; query?: string; category?: string } = {}) {
  const params = new URLSearchParams({ store: storeId, offset: String(options.offset ?? 0), limit: String(options.limit ?? 24) });
  if (options.query) params.set("query", options.query);
  if (options.category) params.set("category", options.category);
  return (await request(`/api/pos/v2/catalog?${params.toString()}`, { organizationId })).json() as Promise<PosCatalogV2Response>;
}
export async function fetchPosV2Customers(organizationId: string, storeId: string, query = "") {
  const params = new URLSearchParams({ store: storeId });
  if (query) params.set("q", query);
  return (await request(`/api/pos/v2/customers?${params.toString()}`, { organizationId })).json() as Promise<PosCustomerSearchResponse>;
}
export async function fetchPosV2Receipts(organizationId: string, options: { query?: string; before?: number } = {}) {
  const params = new URLSearchParams();
  if (options.query) params.set("q", options.query);
  if (options.before) params.set("before", String(options.before));
  return (await request(`/api/pos/v2/receipts?${params.toString()}`, { organizationId })).json() as Promise<PosReceiptListResponse>;
}
export async function fetchPosV2Modifiers(organizationId:string,storeId:string,productId:string){const params=new URLSearchParams({store:storeId,product:productId});return (await request(`/api/pos/v2/modifiers?${params.toString()}`,{organizationId})).json() as Promise<PosModifiersV2Response>;}
export async function validatePosV2CartStock(organizationId:string,input:ValidateCartStockValues){return (await request("/api/pos/v2/cart/validate-stock",{organizationId,init:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)}})).json() as Promise<ValidateCartStockActionResult>;}
