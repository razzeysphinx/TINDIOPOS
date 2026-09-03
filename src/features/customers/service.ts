import "server-only";

import { moneyInputToMinor } from "@/features/catalog/catalog-money";
import {
  createCustomerSegmentSchema,
  createCustomerSchema,
  claimLoyaltyCardRewardSchema,
  importCustomersCsvSchema,
  issueLoyaltyCardSchema,
  loyaltyCardStampSchema,
  loyaltyAdjustmentSchema,
  revokeLoyaltyCardSchema,
  rotateLoyaltyCardQrSchema,
  updateCustomerProfileSchema,
  updateCustomerSegmentSchema,
  updateCustomerStatusSchema,
  updateLoyaltyProgramSchema,
} from "@/features/customers/customer-schema";
import { createLoyaltyCardCode, createLoyaltyCardVerificationToken } from "@/features/customers/loyalty-card-token";
import type { CustomerActionResult, LoyaltyCardCredential } from "@/features/customers/customer-types";
import type { PosCustomer } from "@/features/pos/pos-types";
import type { BusinessContext } from "@/lib/auth/dal";
import type { Json } from "@/lib/supabase/database.types";
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
}): Promise<CustomerActionResult<PosCustomer>> {
  const parsed = createCustomerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the customer details and try again." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .insert({
      organization_id: context.organization.id,
      full_name: parsed.data.fullName,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      address: parsed.data.address || null,
      birthday: parsed.data.birthday || null,
      notes: parsed.data.notes || null,
      loyalty_card_code: parsed.data.loyaltyCardCode || undefined,
    })
    .select("id, customer_number, loyalty_card_code, full_name, email, phone")
    .single();

  if (error || !data) return { ok: false, message: customerDatabaseMessage(error?.message) };

  return {
    ok: true,
    message: "Customer created.",
    data: {
      id: data.id,
      customerNumber: data.customer_number,
      loyaltyCardCode: data.loyalty_card_code,
      fullName: data.full_name,
      email: data.email,
      phone: data.phone,
      loyaltyPoints: 0,
    },
  };
}

export async function importCustomersCsv({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<CustomerActionResult<{ importedCount: number }>> {
  const parsed = importCustomersCsvSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the customer CSV rows and try again." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_customers_csv", {
    target_organization_id: context.organization.id,
    target_rows: parsed.data.rows.map((row) => ({
      row_number: row.rowNumber,
      full_name: row.fullName,
      email: row.email,
      phone: row.phone,
      address: row.address,
      birthday: row.birthday,
      notes: row.notes,
      loyalty_card_code: row.loyaltyCardCode,
    })) as Json,
  });
  if (error || data === null) return { ok: false, message: error?.message?.startsWith("CSV row") ? error.message : "TINDIO could not import this customer CSV file." };
  return { ok: true, message: `${data} customer${data === 1 ? "" : "s"} imported.`, data: { importedCount: data } };
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

export async function issueLoyaltyCard({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<CustomerActionResult<LoyaltyCardCredential>> {
  const parsed = issueLoyaltyCardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the QR loyalty-card details and try again." };

  const verificationToken = createLoyaltyCardVerificationToken();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_loyalty_card", {
    target_organization_id: context.organization.id,
    target_customer_id: parsed.data.customerId,
    target_card_code: createLoyaltyCardCode(),
    target_verification_token: verificationToken,
    target_replaces_card_id: parsed.data.replacesCardId ?? undefined,
    target_reason: parsed.data.reason || undefined,
  });
  const card = data?.[0];
  if (error || !card) {
    return { ok: false, message: error?.code === "23505" ? "This customer already has an active QR loyalty card." : "TINDIO could not issue this QR loyalty card." };
  }

  return {
    ok: true,
    message: parsed.data.replacesCardId ? "Replacement QR loyalty card issued." : "QR loyalty card issued.",
    data: { cardId: card.card_id, cardCode: card.card_code, verificationToken },
  };
}

export async function rotateLoyaltyCardQr({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<CustomerActionResult<LoyaltyCardCredential>> {
  const parsed = rotateLoyaltyCardQrSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the QR rotation reason and try again." };

  const verificationToken = createLoyaltyCardVerificationToken();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rotate_loyalty_card_qr", {
    target_organization_id: context.organization.id,
    target_loyalty_card_id: parsed.data.cardId,
    target_verification_token: verificationToken,
    target_reason: parsed.data.reason,
  });
  const card = data?.[0];
  if (error || !card) return { ok: false, message: "TINDIO could not rotate this QR code." };

  return {
    ok: true,
    message: "A new QR code is ready. Old printed QR codes no longer verify.",
    data: { cardId: card.card_id, cardCode: card.card_code, verificationToken },
  };
}

export async function revokeLoyaltyCard({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<CustomerActionResult> {
  const parsed = revokeLoyaltyCardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter a valid revocation reason." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_loyalty_card", {
    target_organization_id: context.organization.id,
    target_loyalty_card_id: parsed.data.cardId,
    target_reason: parsed.data.reason,
  });
  if (error) return { ok: false, message: "TINDIO could not revoke this QR loyalty card." };
  return { ok: true, message: "QR loyalty card revoked. Its QR code will no longer verify." };
}

export async function addLoyaltyCardStamp({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<CustomerActionResult<{ stampCount: number; stampTarget: number; wasReplayed: boolean }>> {
  const parsed = loyaltyCardStampSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Link a valid completed sale or enter a manual-stamp reason." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_loyalty_card_stamp", {
    target_organization_id: context.organization.id,
    target_loyalty_card_id: parsed.data.cardId,
    target_reason: parsed.data.reason || "Completed sale stamp.",
    target_sale_id: parsed.data.saleId ?? undefined,
    target_idempotency_key: crypto.randomUUID(),
  });
  const result = data?.[0];
  if (error || !result) return { ok: false, message: "TINDIO could not record this loyalty stamp." };
  return {
    ok: true,
    message: result.stamp_count >= result.stamp_target ? "Stamp recorded. This card is now ready for its reward." : "Loyalty stamp recorded.",
    data: { stampCount: result.stamp_count, stampTarget: result.stamp_target, wasReplayed: result.was_replayed },
  };
}

export async function claimLoyaltyCardReward({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<CustomerActionResult> {
  const parsed = claimLoyaltyCardRewardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter a claim reason and try again." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_loyalty_card_reward", {
    target_organization_id: context.organization.id,
    target_loyalty_card_id: parsed.data.cardId,
    target_reason: parsed.data.reason,
    target_sale_id: parsed.data.saleId ?? undefined,
    target_idempotency_key: crypto.randomUUID(),
  });
  if (error || !data?.[0]) return { ok: false, message: "TINDIO could not record this reward claim." };
  return { ok: true, message: "Reward claim recorded. This QR card cannot be claimed a second time." };
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
