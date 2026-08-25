import { NextResponse } from "next/server";

import { checkoutSubmissionSchema } from "@/features/checkout/checkout-schema";
import { completeCheckout } from "@/features/checkout/checkout-service";
import type { CheckoutSaleActionResult } from "@/features/checkout/checkout-types";
import { posDeviceRequestHeaders } from "@/features/devices/device-schema";
import { getBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

async function recordServerObservedOutcome(
  organizationId: string,
  input: unknown,
  result: CheckoutSaleActionResult,
) {
  const parsed = checkoutSubmissionSchema.safeParse(input);
  if (!parsed.success || !parsed.data.offline || (!result.ok && result.retryable)) return;

  const offline = parsed.data.offline;
  const state = result.ok ? "SYNCED" : "CONFLICT";
  const supabase = await createClient({
    headers: posDeviceRequestHeaders(parsed.data.device),
  });
  const { error } = await supabase.rpc("record_offline_sync_event", {
    target_organization_id: organizationId,
    target_store_id: parsed.data.checkout.storeId,
    target_register_id: parsed.data.checkout.registerId,
    target_shift_id: offline.shiftId,
    target_device_id: (offline.deviceId ?? null) as never,
    target_idempotency_key: parsed.data.checkout.idempotencyKey,
    target_local_receipt_reference: offline.localReceiptReference,
    target_local_created_at: offline.createdAt,
    target_state: state,
    target_conflict_type: (result.ok ? null : result.failureCode ?? "PERMISSION_CHANGED") as never,
    target_failure_message: (result.ok ? null : result.message) as never,
    target_official_receipt_number: (result.ok ? result.data.receiptNumber : null) as never,
  });

  if (error) {
    // A checkout is still authoritative if its post-commit manager telemetry
    // cannot be written. The client retains the receipt reference and the
    // checkout idempotency key prevents a duplicate on any retry.
    console.error("TINDIO could not record the offline sync outcome", error);
  }
}

export async function POST(request: Request) {
  const context = await getBusinessContext();
  if (!context) {
    return NextResponse.json(
      { ok: false, message: "Sign in is required before queued sales can sync." },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "The queued sale data is invalid.", retryable: false },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    const result = await completeCheckout(context, input, { guardOfflineTotal: true });
    await recordServerObservedOutcome(context.organization.id, input, result);
    return NextResponse.json(result, {
      status: result.ok ? 200 : result.retryable ? 503 : 409,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("TINDIO offline checkout sync failed", error);
    return NextResponse.json(
      {
        ok: false,
        message: "TINDIO could not confirm this queued sale. It will remain queued for review.",
        retryable: true,
      },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
