import "server-only";

import { moneyInputToMinor } from "@/features/catalog/catalog-money";
import {
  createCustomerSegmentSchema,
  createCustomerSchema,
  loyaltyAdjustmentSchema,
  updateCustomerProfileSchema,
  updateCustomerSegmentSchema,
  updateCustomerStatusSchema,
  updateLoyaltyProgramSchema,
} from "@/features/customers/customer-schema";
import type { CustomerActionResult } from "@/features/customers/customer-types";
import type { BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

function customerDatabaseMessage(message: string | undefined) {
  if (message?.includes("customers_")) return "Check the customer details and try again.";
  return "TINDIO could not save this customer.";
}

export async function createCustomer({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<CustomerActionResult> {
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

  return { ok: true, message: "Customer created." };
}

export async function createCustomerSegment({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<CustomerActionResult> {
  const parsed = createCustomerSegmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the segment details and try again." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_customer_segment", {
    target_organization_id: context.organization.id,
    target_name: parsed.data.name,
    target_description: (parsed.data.description || null) as never,
  });

  if (error) return { ok: false, message: "TINDIO could not create this customer segment." };

  return { ok: true, message: "Customer segment created." };
}

export async function updateCustomerSegment({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<CustomerActionResult> {
  const parsed = updateCustomerSegmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the segment details and try again." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_segments")
    .update({
      name: parsed.data.name,
      description: parsed.data.description || null,
    })
    .eq("id", parsed.data.segmentId)
    .eq("organization_id", context.organization.id)
    .select("id")
    .maybeSingle();

  if (error || !data) return { ok: false, message: "TINDIO could not update this customer segment." };
  return { ok: true, message: "Customer segment updated." };
}

export async function updateCustomerProfile({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<CustomerActionResult> {
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

  return { ok: true, message: "Customer profile saved." };
}

export async function adjustCustomerLoyaltyPoints({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<CustomerActionResult> {
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

  return { ok: true, message: "Loyalty adjustment recorded in the ledger." };
}

export async function updateCustomerStatus({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<CustomerActionResult> {
  const parsed = updateCustomerStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid customer status." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.customerId)
    .eq("organization_id", context.organization.id);

  if (error) return { ok: false, message: customerDatabaseMessage(error.message) };

  return {
    ok: true,
    message: parsed.data.status === "archived" ? "Customer archived." : "Customer reactivated.",
  };
}

export async function updateLoyaltyProgram({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<CustomerActionResult> {
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

  return { ok: true, message: "Loyalty settings saved." };
}
