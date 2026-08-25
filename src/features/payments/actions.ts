"use server";

import { revalidatePath } from "next/cache";

import {
  createPaymentMethodSchema,
  setPaymentMethodOfflinePolicySchema,
  setStorePaymentMethodAvailabilitySchema,
  updatePaymentMethodSchema,
} from "@/features/payments/payment-method-schema";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export type PaymentMethodActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

function revalidatePaymentMethodViews() {
  revalidatePath("/back-office/payment-methods");
  revalidatePath("/pos");
}

function databaseMessage(
  code: string | null | undefined,
  message: string | null | undefined,
  fallback: string,
) {
  if (code === "23505") return "That payment method name or code is already in use.";
  if (code === "42501") return "You do not have permission to change payment methods.";
  if ((code === "23514" || code === "P0002") && message) return message;
  return fallback;
}

export async function createPaymentMethodAction(
  input: unknown,
): Promise<PaymentMethodActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "settings.manage")) {
    return { ok: false, message: "You do not have permission to create payment methods." };
  }

  const parsed = createPaymentMethodSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the payment method details and selected stores." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_store_scoped_payment_method", {
    target_organization_id: context.organization.id,
    target_name: parsed.data.name,
    target_code: parsed.data.code,
    target_payment_type: parsed.data.paymentType,
    target_requires_reference: parsed.data.requiresReference,
    target_store_ids: parsed.data.storeIds,
  });

  if (error || !data) {
    return {
      ok: false,
      message: databaseMessage(
        error?.code,
        error?.message,
        "TINDIO could not create this payment method.",
      ),
    };
  }

  revalidatePaymentMethodViews();
  return { ok: true, message: "Payment method created." };
}

export async function updatePaymentMethodAction(
  input: unknown,
): Promise<PaymentMethodActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "settings.manage")) {
    return { ok: false, message: "You do not have permission to update payment methods." };
  }

  const parsed = updatePaymentMethodSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the payment method details." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_payment_method_configuration", {
    target_organization_id: context.organization.id,
    target_payment_method_id: parsed.data.paymentMethodId,
    target_name: parsed.data.name,
    target_is_enabled: parsed.data.isEnabled,
    target_requires_reference: parsed.data.requiresReference,
    target_sort_order: parsed.data.sortOrder,
  });

  if (error || !data) {
    return {
      ok: false,
      message: databaseMessage(
        error?.code,
        error?.message,
        "TINDIO could not update this payment method.",
      ),
    };
  }

  revalidatePaymentMethodViews();
  return { ok: true, message: "Payment method saved." };
}

export async function setStorePaymentMethodAvailabilityAction(
  input: unknown,
): Promise<PaymentMethodActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "settings.manage")) {
    return { ok: false, message: "You do not have permission to change store availability." };
  }

  const parsed = setStorePaymentMethodAvailabilitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Select a valid payment method and store." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_store_payment_method_configuration", {
    target_organization_id: context.organization.id,
    target_store_id: parsed.data.storeId,
    target_payment_method_id: parsed.data.paymentMethodId,
    target_is_enabled: parsed.data.isEnabled,
  });

  if (error || !data) {
    return {
      ok: false,
      message: databaseMessage(
        error?.code,
        error?.message,
        "TINDIO could not update store availability.",
      ),
    };
  }

  revalidatePaymentMethodViews();
  return { ok: true, message: "Store availability updated." };
}

export async function setPaymentMethodOfflinePolicyAction(
  input: unknown,
): Promise<PaymentMethodActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "settings.manage")) {
    return { ok: false, message: "You do not have permission to change offline payment policies." };
  }

  const parsed = setPaymentMethodOfflinePolicySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid offline payment policy." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_payment_method_offline_policy", {
    target_organization_id: context.organization.id,
    target_payment_method_id: parsed.data.paymentMethodId,
    target_offline_policy: parsed.data.offlinePolicy,
  });

  if (error) {
    return {
      ok: false,
      message: databaseMessage(
        error.code,
        error.message,
        "TINDIO could not update the offline payment policy.",
      ),
    };
  }

  revalidatePaymentMethodViews();
  return { ok: true, message: "Offline payment policy saved." };
}
