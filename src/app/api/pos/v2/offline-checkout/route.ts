import { NextResponse } from "next/server";
import { checkoutSubmissionSchema } from "@/features/checkout/checkout-schema";
import { completeCheckout } from "@/features/checkout/checkout-service";
import type { CheckoutSaleActionResult, CheckoutSequenceInfo } from "@/features/checkout/checkout-types";
import { posDeviceRequestHeaders } from "@/features/devices/device-schema";
import type { BusinessContext } from "@/lib/auth/dal";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";
import { createBusinessContextClient } from "@/lib/supabase/context-client";

const noStore = { "Cache-Control": "private, no-store" };
const sequenceStatuses = new Set<CheckoutSequenceInfo["status"]>([
  "ACCEPTED", "REPLAY", "GAP", "DUPLICATE_SEQUENCE", "OUT_OF_ORDER", "IDEMPOTENCY_SEQUENCE_MISMATCH",
]);

type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: Array<Record<string, unknown>> | null; error: { message?: string } | null }> };

function response(result: CheckoutSaleActionResult, status: number) {
  return NextResponse.json(result, { status, headers: noStore });
}

function sequenceInfo(value: Record<string, unknown>, deviceSequence: number): CheckoutSequenceInfo | null {
  const status = value.status;
  const serverCheckpoint = Number(value.server_checkpoint);
  const expectedSequence = Number(value.expected_sequence);
  if (typeof status !== "string" || !sequenceStatuses.has(status as CheckoutSequenceInfo["status"]) ||
      !Number.isSafeInteger(serverCheckpoint) || !Number.isSafeInteger(expectedSequence)) return null;
  return { deviceSequence, serverCheckpoint, expectedSequence, status: status as CheckoutSequenceInfo["status"] };
}

function sequenceFailure(sync: CheckoutSequenceInfo): CheckoutSaleActionResult {
  const failureCode = sync.status === "GAP" ? "SEQUENCE_GAP" :
    sync.status === "OUT_OF_ORDER" ? "SEQUENCE_OUT_OF_ORDER" : "SEQUENCE_CONFLICT";
  return { ok: false, retryable: false, failureCode, sync, message: "This saved sale cannot be applied until its device sequence is reconciled." };
}

async function validateAndReserveSequence(context: BusinessContext, input: unknown): Promise<
  { kind: "none" } | { kind: "rejected"; result: CheckoutSaleActionResult; status: number } | { kind: "retryable" } | { kind: "reserved"; sync: CheckoutSequenceInfo }
> {
  const parsed = checkoutSubmissionSchema.safeParse(input);
  if (!parsed.success) return { kind: "none" };
  const offline = parsed.data.offline;
  if (!offline || offline.deviceSequence === undefined) return { kind: "none" };
  if (!parsed.data.device || offline.deviceId !== parsed.data.device.deviceId) {
    return { kind: "rejected", status: 409, result: { ok: false, retryable: false, failureCode: "SEQUENCE_CONFLICT", message: "The saved sale device identity is invalid." } };
  }
  const database = await createBusinessContextClient(context, { headers: posDeviceRequestHeaders(parsed.data.device) }) as unknown as RpcClient;
  const validation = await database.rpc("validate_pos_device", {
    target_organization_id: context.organization.id, target_device_id: parsed.data.device.deviceId,
    target_secret: parsed.data.device.secret, target_app_version: parsed.data.device.appVersion,
  });
  const device = validation.data?.[0];
  if (validation.error || !device || String(device.device_id) !== parsed.data.device.deviceId ||
      String(device.store_id) !== parsed.data.checkout.storeId || String(device.register_id) !== parsed.data.checkout.registerId) {
    return { kind: "rejected", status: 403, result: { ok: false, retryable: false, failureCode: "DEVICE_REVOKED", message: "This POS device is not active for the saved sale terminal." } };
  }
  const reservation = await database.rpc("reserve_pos_device_sequence", {
    target_organization_id: context.organization.id, target_device_id: parsed.data.device.deviceId,
    target_store_id: parsed.data.checkout.storeId, target_register_id: parsed.data.checkout.registerId,
    target_device_sequence: offline.deviceSequence, target_idempotency_key: parsed.data.checkout.idempotencyKey,
    target_local_receipt_reference: offline.localReceiptReference,
  });
  const sync = reservation.data?.[0] ? sequenceInfo(reservation.data[0], offline.deviceSequence) : null;
  if (reservation.error || !sync) return { kind: "retryable" };
  if (sync.status !== "ACCEPTED" && sync.status !== "REPLAY") return { kind: "rejected", status: 409, result: sequenceFailure(sync) };
  return { kind: "reserved", sync };
}

async function finalizeSequence(context: BusinessContext, input: unknown, sync: CheckoutSequenceInfo, result: CheckoutSaleActionResult) {
  if (result.ok || !result.retryable) {
    const parsed = checkoutSubmissionSchema.parse(input);
    const database = await createBusinessContextClient(context, { headers: posDeviceRequestHeaders(parsed.device) }) as unknown as RpcClient;
    const finalized = await database.rpc("finalize_pos_device_sequence", {
      target_organization_id: context.organization.id, target_device_id: parsed.device!.deviceId,
      target_device_sequence: sync.deviceSequence, target_idempotency_key: parsed.checkout.idempotencyKey,
      target_final_state: result.ok ? "APPLIED" : "CONFLICT",
    });
    const checkpoint = Number(finalized.data?.[0]?.server_checkpoint);
    if (finalized.error || !Number.isSafeInteger(checkpoint)) return null;
    return { ...sync, serverCheckpoint: checkpoint, expectedSequence: checkpoint + 1 };
  }
  return sync;
}

async function recordServerObservedOutcome(context: BusinessContext, input: unknown, result: CheckoutSaleActionResult) {
  const parsed = checkoutSubmissionSchema.safeParse(input);
  if (!parsed.success || !parsed.data.offline || (!result.ok && result.retryable)) return;
  const offline = parsed.data.offline;
  const supabase = await createBusinessContextClient(context, { headers: posDeviceRequestHeaders(parsed.data.device) });
  const conflictType = !result.ok && ["SEQUENCE_GAP", "SEQUENCE_CONFLICT", "SEQUENCE_OUT_OF_ORDER"].includes(result.failureCode ?? "")
    ? "PERMISSION_CHANGED" : !result.ok ? result.failureCode ?? "PERMISSION_CHANGED" : null;
  const { error } = await supabase.rpc("record_offline_sync_event", {
    target_organization_id: context.organization.id, target_store_id: parsed.data.checkout.storeId,
    target_register_id: parsed.data.checkout.registerId, target_shift_id: offline.shiftId,
    target_device_id: offline.deviceId as never, target_idempotency_key: parsed.data.checkout.idempotencyKey,
    target_local_receipt_reference: offline.localReceiptReference, target_local_created_at: offline.createdAt,
    target_state: result.ok ? "SYNCED" : "CONFLICT", target_conflict_type: conflictType as never,
    target_failure_message: (result.ok ? null : result.message) as never,
    target_official_receipt_number: (result.ok ? result.data.receiptNumber : null) as never,
  });
  if (error) console.error("TINDIO could not record the offline sync outcome", error);
}

export async function POST(request: Request) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const context = resolved.context;
  const input = await request.json().catch(() => null);
  if (input === null) return response({ ok: false, message: "The queued sale data is invalid.", retryable: false }, 400);
  try {
    const reservation = await validateAndReserveSequence(context, input);
    if (reservation.kind === "rejected") {
      await recordServerObservedOutcome(context, input, reservation.result);
      return response(reservation.result, reservation.status);
    }
    if (reservation.kind === "retryable") return response({ ok: false, message: "TINDIO could not reserve this device sequence. The saved sale will remain queued.", retryable: true }, 503);
    const result = await completeCheckout(context, input, { guardOfflineTotal: true });
    const sync = reservation.kind === "reserved" ? await finalizeSequence(context, input, reservation.sync, result) : undefined;
    if (reservation.kind === "reserved" && !sync) {
      return response({ ok: false, message: "TINDIO accepted the sale but could not finalize its sequence checkpoint. Retry this same saved sale.", retryable: true }, 503);
    }
    const sequencedResult = sync ? { ...result, sync } : result;
    await recordServerObservedOutcome(context, input, sequencedResult);
    return response(sequencedResult, sequencedResult.ok ? 200 : sequencedResult.retryable ? 503 : 409);
  } catch (error) {
    console.error("TINDIO offline checkout sync failed", error);
    return response({ ok: false, message: "TINDIO could not confirm this queued sale. It will remain queued for review.", retryable: true }, 503);
  }
}
