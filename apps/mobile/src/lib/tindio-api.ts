import "react-native-url-polyfill/auto";

import type {
  AttendanceEmployeesResult,
  PosBootstrapV2CoreResponse,
  PosCatalogV2Response,
  PosCloseShiftV2Response,
  PosCustomer,
  PosCustomerSearchResponse,
  PosDeviceBinding,
  PosDeviceCredential,
  PosDeviceSyncCheckpoint,
  PosDeviceValidationResponse,
  PosLiveV2Response,
  PosModifiersV2Response,
  PosOpenShiftV2Response,
  PosReceiptDetail,
  PosReceiptListResponse,
  PosReferenceV2Response,
  PosSyncBaselineResponse,
  PosSyncPullResponse,
  PosSyncPushEvent,
  PosSyncPushResponse,
  TicketActionResult,
  TicketMutationResult,
  TimeClockActionResult,
  ValidateCartStockActionResult,
  ValidateCartStockValues,
} from "../../../../src/contracts/pos";
import type { CheckoutSaleActionResult } from "../../../../src/features/checkout/checkout-types";
import { mobileEnvironment } from "./env";
import { recordApiCall } from "../features/performance/performance-metrics";
import { supabase } from "./supabase";

const ORGANIZATION_HEADER = "x-tindio-organization-id";
const STORE_HEADER = "x-tindio-store-id";
const REGISTER_HEADER = "x-tindio-register-id";

export type BasicActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export type CustomerCreateResult =
  | { ok: true; message: string; data?: PosCustomer }
  | { ok: false; message: string };

export type RefundResult =
  | {
      ok: true;
      message: string;
      data: {
        refundId: string;
        refundNumber: number;
        totalMinor: number;
        wasReplayed: boolean;
      };
    }
  | { ok: false; message: string };

export type TransferReceiveResult =
  | { ok: true; message: string; data?: { receiptId?: string; stockRequestId?: string } }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

export class TindioApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "TindioApiError";
  }
}

export function isExplicitAuthorizationDenial(error: unknown) {
  return (
    error instanceof TindioApiError
    && (error.status === 401 || error.status === 403)
    && error.reason.startsWith("HTTP_")
  );
}

const endpoint = (pathname: string) =>
  new URL(pathname, `${mobileEnvironment.tindioApiUrl}/`).toString();

async function token(refresh: boolean) {
  const result = refresh
    ? await supabase.auth.refreshSession()
    : await supabase.auth.getSession();

  if (result.error || !result.data.session) {
    throw new TindioApiError("Sign in is required.", 401, "AUTH_REQUIRED", null);
  }

  return result.data.session.access_token;
}

export async function requestPosV2Raw(
  pathname: string,
  {
    organizationId,
    init = {},
  }: {
    organizationId?: string;
    init?: RequestInit;
  } = {},
) {
  const startedAt = Date.now();
  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${await token(false)}`,
  });

  if (organizationId) headers.set(ORGANIZATION_HEADER, organizationId);

  for (const [key, value] of new Headers(init.headers).entries()) {
    headers.set(key, value);
  }

  let response = await fetch(endpoint(pathname), {
    ...init,
    method: init.method ?? "GET",
    headers,
  });

  if (response.status === 401) {
    headers.set("Authorization", `Bearer ${await token(true)}`);
    response = await fetch(endpoint(pathname), {
      ...init,
      method: init.method ?? "GET",
      headers,
    });
  }

  recordApiCall({ durationMs: Date.now() - startedAt, responseBytes: Number(response.headers.get("content-length") ?? 0) || 0, retried: false, failed: !response.ok });
  return response;
}

async function request(
  pathname: string,
  options: {
    organizationId?: string;
    init?: RequestInit;
  } = {},
) {
  const response = await requestPosV2Raw(pathname, options);

  if (!response.ok) {
    throw new TindioApiError(
      `HTTP_${response.status}`,
      response.status,
      `HTTP_${response.status}`,
      response.headers.get("x-tindio-request-id"),
    );
  }

  return response;
}

const jsonPost = (input: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(input),
});

export async function fetchPosV2Core(organizationId?: string) {
  return (await request("/api/pos/v2/bootstrap", { organizationId }))
    .json() as Promise<PosBootstrapV2CoreResponse>;
}

export async function enrollPosV2Device(
  organizationId: string,
  input: PosDeviceCredential & {
    storeId: string;
    registerId: string;
    name: string;
  },
) {
  return (await request("/api/pos/v2/device/enroll", {
    organizationId,
    init: jsonPost(input),
  })).json() as Promise<{ ok: true; device: PosDeviceBinding }>;
}

export async function validatePosV2Device(
  organizationId: string,
  credential: PosDeviceCredential,
) {
  return (await request("/api/pos/v2/device", {
    organizationId,
    init: jsonPost({ organizationId, device: credential }),
  })).json() as Promise<PosDeviceValidationResponse>;
}

export async function fetchPosV2DeviceCheckpoint(
  organizationId: string,
  credential: PosDeviceCredential,
) {
  return (await request("/api/pos/v2/sync/checkpoint", {
    organizationId,
    init: jsonPost({ organizationId, device: credential }),
  })).json() as Promise<
    | { ok: true; checkpoint: PosDeviceSyncCheckpoint }
    | { ok: false; message: string }
  >;
}

export async function fetchPosV2SyncBaseline(
  organizationId: string,
  device: PosDeviceCredential,
) {
  return (await request("/api/pos/v2/sync/baseline", {
    organizationId,
    init: jsonPost({ organizationId, device }),
  })).json() as Promise<PosSyncBaselineResponse>;
}

export async function pushPosV2SyncBatch(
  organizationId: string,
  device: PosDeviceCredential,
  events: PosSyncPushEvent[],
) {
  return (await request("/api/pos/v2/sync/push", {
    organizationId,
    init: jsonPost({ organizationId, device, events }),
  })).json() as Promise<PosSyncPushResponse>;
}

export async function pullPosV2Delta(
  organizationId: string,
  device: PosDeviceCredential,
  cursor: number,
  limit = 100,
) {
  return (await request("/api/pos/v2/sync/pull", {
    organizationId,
    init: jsonPost({ organizationId, device, cursor, limit }),
  })).json() as Promise<PosSyncPullResponse>;
}

export async function fetchPosV2Live(
  organizationId: string,
  binding: PosDeviceBinding,
) {
  return (await request("/api/pos/v2/live", {
    organizationId,
    init: {
      headers: {
        [STORE_HEADER]: binding.storeId,
        [REGISTER_HEADER]: binding.registerId,
      },
    },
  })).json() as Promise<PosLiveV2Response>;
}

export async function openPosV2Shift(
  organizationId: string,
  binding: PosDeviceBinding,
  credential: PosDeviceCredential,
  input: {
    openingCash: string;
    openingNote?: string;
  },
) {
  return (await request("/api/pos/v2/shifts/open", {
    organizationId,
    init: jsonPost({
      storeId: binding.storeId,
      registerId: binding.registerId,
      ...input,
      device: credential,
    }),
  })).json() as Promise<PosOpenShiftV2Response>;
}

export async function closePosV2Shift(
  organizationId: string,
  input: {
    shiftId: string;
    countedCash: string;
    closingNote?: string;
  },
) {
  return (await request("/api/pos/v2/shifts/close", {
    organizationId,
    init: jsonPost(input),
  })).json() as Promise<PosCloseShiftV2Response>;
}

export async function recordPosV2CashMovement(
  organizationId: string,
  input: {
    shiftId: string;
    movementType: "PAY_IN" | "PAY_OUT";
    amount: string;
    reason: string;
    idempotencyKey: string;
    approvalRequestId?: string | null;
  },
) {
  return (await request("/api/pos/v2/shifts/cash-movement", {
    organizationId,
    init: jsonPost(input),
  })).json() as Promise<PosCloseShiftV2Response>;
}

export async function fetchPosV2Reference(organizationId: string) {
  return (await request("/api/pos/v2/reference", { organizationId }))
    .json() as Promise<PosReferenceV2Response>;
}

export async function fetchPosV2CatalogPage(
  organizationId: string,
  storeId: string,
  options: {
    offset?: number;
    limit?: number;
    query?: string;
    category?: string;
  } = {},
) {
  const params = new URLSearchParams({
    store: storeId,
    offset: String(options.offset ?? 0),
    limit: String(options.limit ?? 24),
  });

  if (options.query) params.set("query", options.query);
  if (options.category) params.set("category", options.category);

  return (await request(`/api/pos/v2/catalog?${params.toString()}`, {
    organizationId,
  })).json() as Promise<PosCatalogV2Response>;
}

export async function fetchPosV2Customers(
  organizationId: string,
  storeId: string,
  query = "",
) {
  const params = new URLSearchParams({ store: storeId });
  if (query) params.set("q", query);

  return (await request(`/api/pos/v2/customers?${params.toString()}`, {
    organizationId,
  })).json() as Promise<PosCustomerSearchResponse>;
}

export async function searchPosV2Customers(
  organizationId: string,
  storeId: string,
  query = "",
) {
  return fetchPosV2Customers(organizationId, storeId, query);
}

export async function createPosV2Customer(
  organizationId: string,
  input: {
    fullName: string;
    email: string;
    phone: string;
    address: string;
    birthday: string;
    notes: string;
    loyaltyCardCode: string;
  },
) {
  return (await request("/api/pos/v2/customers/create", {
    organizationId,
    init: jsonPost(input),
  })).json() as Promise<CustomerCreateResult>;
}

export async function fetchPosV2Receipts(
  organizationId: string,
  options: {
    query?: string;
    before?: number;
  } = {},
) {
  const params = new URLSearchParams();

  if (options.query) params.set("q", options.query);
  if (options.before) params.set("before", String(options.before));

  return (await request(`/api/pos/v2/receipts?${params.toString()}`, {
    organizationId,
  })).json() as Promise<PosReceiptListResponse>;
}

export async function fetchPosV2ReceiptDetail(
  organizationId: string,
  receiptId: string,
) {
  return (await request(`/api/pos/v2/receipts/${receiptId}`, {
    organizationId,
  })).json() as Promise<PosReceiptDetail>;
}

export async function deliverPosV2Receipt(
  organizationId: string,
  receiptId: string,
  input: {
    receiptId: string;
    recipient: string;
    idempotencyKey: string;
  },
) {
  return (await request(`/api/pos/v2/receipts/${receiptId}/delivery`, {
    organizationId,
    init: jsonPost(input),
  })).json() as Promise<BasicActionResult>;
}

export async function refundPosV2Receipt(
  organizationId: string,
  receiptId: string,
  input: {
    receiptId: string;
    paymentMethodId: string;
    idempotencyKey: string;
    reason: string;
    referenceNumber: string;
    items: Array<{
      saleItemId: string;
      quantity: number;
      returnToStock: boolean;
    }>;
  },
) {
  return (await request(`/api/pos/v2/receipts/${receiptId}/refund`, {
    organizationId,
    init: jsonPost(input),
  })).json() as Promise<RefundResult>;
}

export async function fetchPosV2Modifiers(
  organizationId: string,
  storeId: string,
  productId: string,
) {
  const params = new URLSearchParams({
    store: storeId,
    product: productId,
  });

  return (await request(`/api/pos/v2/modifiers?${params.toString()}`, {
    organizationId,
  })).json() as Promise<PosModifiersV2Response>;
}

export async function validatePosV2CartStock(
  organizationId: string,
  input: ValidateCartStockValues,
) {
  return (await request("/api/pos/v2/cart/validate-stock", {
    organizationId,
    init: jsonPost(input),
  })).json() as Promise<ValidateCartStockActionResult>;
}

export async function checkoutPosV2(
  organizationId: string,
  input: unknown,
) {
  return (await request("/api/pos/v2/checkout", {
    organizationId,
    init: jsonPost(input),
  })).json() as Promise<CheckoutSaleActionResult>;
}

export async function fetchPosV2AttendanceEmployees(
  organizationId: string,
  storeId: string,
) {
  return (await request(
    `/api/pos/v2/attendance/employees?store=${encodeURIComponent(storeId)}`,
    { organizationId },
  )).json() as Promise<AttendanceEmployeesResult>;
}

export async function clockInPosV2Employee(
  organizationId: string,
  input: {
    storeId: string;
    employeeId: string;
    pin: string;
    requestId: string;
  },
) {
  return (await request("/api/pos/v2/attendance/clock-in", {
    organizationId,
    init: jsonPost(input),
  })).json() as Promise<TimeClockActionResult>;
}

export async function clockOutPosV2Employee(
  organizationId: string,
  input: {
    employeeId: string;
    pin: string;
    requestId: string;
  },
) {
  return (await request("/api/pos/v2/attendance/clock-out", {
    organizationId,
    init: jsonPost(input),
  })).json() as Promise<TimeClockActionResult>;
}

export async function savePosV2Ticket(
  organizationId: string,
  input: unknown,
) {
  return (await request("/api/pos/v2/tickets/save", {
    organizationId,
    init: jsonPost(input),
  })).json() as Promise<TicketActionResult>;
}

export async function cancelPosV2Ticket(
  organizationId: string,
  input: unknown,
) {
  return (await request("/api/pos/v2/tickets/cancel", {
    organizationId,
    init: jsonPost(input),
  })).json() as Promise<TicketMutationResult>;
}

export async function splitPosV2Ticket(
  organizationId: string,
  input: unknown,
) {
  return (await request("/api/pos/v2/tickets/split", {
    organizationId,
    init: jsonPost(input),
  })).json() as Promise<TicketActionResult>;
}

export async function mergePosV2Ticket(
  organizationId: string,
  input: unknown,
) {
  return (await request("/api/pos/v2/tickets/merge", {
    organizationId,
    init: jsonPost(input),
  })).json() as Promise<TicketMutationResult>;
}

export async function movePosV2TicketLines(
  organizationId: string,
  input: unknown,
) {
  return (await request("/api/pos/v2/tickets/move-lines", {
    organizationId,
    init: jsonPost(input),
  })).json() as Promise<TicketMutationResult>;
}

export async function receivePosV2Transfer(
  organizationId: string,
  transferId: string,
  input: unknown,
) {
  return (await request(`/api/pos/v2/transfers/${transferId}/receive`, {
    organizationId,
    init: jsonPost(input),
  })).json() as Promise<TransferReceiveResult>;
}

export async function receivePosV2StockRequest(
  organizationId: string,
  stockRequestId: string,
  input: unknown,
) {
  return (await request(`/api/pos/v2/stock-requests/${stockRequestId}/receive`, {
    organizationId,
    init: jsonPost(input),
  })).json() as Promise<TransferReceiveResult>;
}

export async function reportPosV2SyncTelemetry(
  organizationId: string,
  input: {
    device: PosDeviceCredential;
    employeeId: string;
    employeeName: string;
    connectionMode:
      | "CLOUD_ONLINE"
      | "STORE_LOCAL"
      | "DEVICE_ISOLATED"
      | "RECOVERING"
      | "SYNC_REVIEW";
    lastSuccessfulSyncAt: string | null;
    deviceCheckpoint: number;
    serverCheckpoint: number;
    queueDepth: number;
    conflictCount: number;
    failedCount: number;
    offlineSince: string | null;
  },
) {
  return (
    await request(
      "/api/pos/v2/sync/telemetry",
      {
        organizationId,
        init: jsonPost({
          organizationId,
          ...input,
        }),
      },
    )
  ).json() as Promise<{
    ok: true;
    deviceId: string;
    heartbeatAt: string;
  }>;
}
