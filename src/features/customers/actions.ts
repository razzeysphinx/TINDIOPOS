"use server";

import { revalidatePath } from "next/cache";

import { moneyInputToMinor } from "@/features/catalog/catalog-money";
import {
  createCustomerSegmentSchema,
  createCustomerSchema,
  loyaltyAdjustmentSchema,
  updateCustomerProfileSchema,
  updateCustomerStatusSchema,
  updateLoyaltyProgramSchema,
} from "@/features/customers/customer-schema";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

type CustomerActionResult = { ok: true; message: string } | { ok: false; message: string };

function customerDatabaseMessage(message: string | undefined) {
  if (message?.includes("customers_")) return "Check the customer details and try again.";
  return "TINDIO could not save this customer.";
}

export async function createCustomerAction(input: unknown): Promise<CustomerActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "customers.manage")) {
    return { ok: false, message: "You do not have permission to manage customers." };
  }

  const parsed = createCustomerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the customer details and try again." };

  const supabase = await createClient();
  const { error } = await supabase.from("customers").insert({
    organization_id: context.organization.id,
    full_name: parsed.data.fullName,
    email: parsed.data.email || null,
    phone: parsed.data.phone || null,
    address: parsed.data.address || null,
    birthday: parsed.data.birthday || null,
    notes: parsed.data.notes || null,
    loyalty_card_code: parsed.data.loyaltyCardCode || undefined,
  });

  if (error) return { ok: false, message: customerDatabaseMessage(error.message) };

  revalidatePath("/back-office/customers");
  return { ok: true, message: "Customer created." };
}

export async function createCustomerSegmentAction(input: unknown): Promise<CustomerActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "customers.manage")) {
    return { ok: false, message: "You do not have permission to manage customer segments." };
  }

  const parsed = createCustomerSegmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the segment details and try again." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_customer_segment", {
    target_organization_id: context.organization.id,
    target_name: parsed.data.name,
    target_description: (parsed.data.description || null) as never,
  });

  if (error) return { ok: false, message: "TINDIO could not create this customer segment." };

  revalidatePath("/back-office/customers");
  return { ok: true, message: "Customer segment created." };
}

export async function updateCustomerProfileAction(input: unknown): Promise<CustomerActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "customers.manage")) {
    return { ok: false, message: "You do not have permission to manage customers." };
  }

  const parsed = updateCustomerProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the customer profile and try again." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_customer_profile", {
    target_organization_id: context.organization.id,
    target_customer_id: parsed.data.customerId,
    target_full_name: parsed.data.fullName,
    target_email: (parsed.data.email || null) as never,
    target_phone: (parsed.data.phone || null) as never,
    target_address: (parsed.data.address || null) as never,
    target_birthday: (parsed.data.birthday || null) as never,
    target_notes: (parsed.data.notes || null) as never,
    target_loyalty_card_code: (parsed.data.loyaltyCardCode || null) as never,
    target_segment_ids: parsed.data.segmentIds,
  });

  if (error) return { ok: false, message: customerDatabaseMessage(error.message) };

  revalidatePath("/back-office/customers");
  revalidatePath(`/back-office/customers/${parsed.data.customerId}`);
  revalidatePath("/pos");
  return { ok: true, message: "Customer profile saved." };
}

export async function adjustCustomerLoyaltyPointsAction(input: unknown): Promise<CustomerActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "customers.manage")) {
    return { ok: false, message: "You do not have permission to adjust loyalty points." };
  }

  const parsed = loyaltyAdjustmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the point adjustment and reason." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("adjust_customer_loyalty_points", {
    target_organization_id: context.organization.id,
    target_customer_id: parsed.data.customerId,
    target_points_delta: parsed.data.pointsDelta,
    target_reason: parsed.data.reason,
  });

  if (error) return { ok: false, message: "TINDIO could not record this loyalty adjustment." };

  revalidatePath("/back-office/customers");
  revalidatePath(`/back-office/customers/${parsed.data.customerId}`);
  revalidatePath("/pos");
  return { ok: true, message: "Loyalty adjustment recorded in the ledger." };
}

export async function updateCustomerStatusAction(input: unknown): Promise<CustomerActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "customers.manage")) {
    return { ok: false, message: "You do not have permission to manage customers." };
  }

  const parsed = updateCustomerStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid customer status." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.customerId)
    .eq("organization_id", context.organization.id);

  if (error) return { ok: false, message: customerDatabaseMessage(error.message) };

  revalidatePath("/back-office/customers");
  revalidatePath(`/back-office/customers/${parsed.data.customerId}`);
  return {
    ok: true,
    message: parsed.data.status === "archived" ? "Customer archived." : "Customer reactivated.",
  };
}

export async function updateLoyaltyProgramAction(input: unknown): Promise<CustomerActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "settings.manage")) {
    return { ok: false, message: "You do not have permission to change loyalty settings." };
  }

  const parsed = updateLoyaltyProgramSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the loyalty settings and try again." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("loyalty_programs")
    .update({
      is_enabled: parsed.data.isEnabled,
      earn_spend_minor: moneyInputToMinor(parsed.data.earnSpend),
      earn_points: parsed.data.earnPoints,
      redemption_value_minor: moneyInputToMinor(parsed.data.redemptionValue),
      minimum_redemption_points: parsed.data.minimumRedemptionPoints,
    })
    .eq("organization_id", context.organization.id);

  if (error) return { ok: false, message: "TINDIO could not save these loyalty settings." };

  revalidatePath("/back-office/customers");
  revalidatePath("/pos");
  return { ok: true, message: "Loyalty settings saved." };
}
