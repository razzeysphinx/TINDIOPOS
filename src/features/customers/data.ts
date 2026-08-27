import "server-only";

import type {
  CustomerLedgerEntry,
  LoyaltyCard,
  LoyaltyCardEvent,
  CustomerProfile,
  CustomerProfileWorkspace,
  CustomerPurchase,
  CustomerSegmentOption,
  CustomersOverview,
  CustomerSummary,
} from "@/features/customers/customer-types";
import type { BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export async function loadCustomersOverview(
  context: BusinessContext,
): Promise<CustomersOverview> {
  const supabase = await createClient();
  const [customersResult, transactionsResult, programResult, segmentsResult] = await Promise.all([
    supabase
      .from("customers")
      .select("id, customer_number, loyalty_card_code, full_name, email, phone, status, created_at")
      .eq("organization_id", context.organization.id)
      .order("full_name", { ascending: true })
      .limit(100),
    supabase
      .from("loyalty_transactions")
      .select("customer_id, points_delta")
      .eq("organization_id", context.organization.id),
    supabase
      .from("loyalty_programs")
      .select("is_enabled, earn_spend_minor, earn_points, redemption_value_minor, minimum_redemption_points")
      .eq("organization_id", context.organization.id)
      .maybeSingle(),
    supabase
      .from("customer_segments")
      .select("id, name, description")
      .eq("organization_id", context.organization.id)
      .order("name", { ascending: true }),
  ]);

  const error = [customersResult, transactionsResult, programResult, segmentsResult].find((result) => result.error)?.error;
  if (error) throw new Error(`Unable to load customers: ${error.message}`);

  const pointBalanceByCustomer = new Map<string, number>();
  for (const transaction of transactionsResult.data ?? []) {
    pointBalanceByCustomer.set(
      transaction.customer_id,
      (pointBalanceByCustomer.get(transaction.customer_id) ?? 0) + transaction.points_delta,
    );
  }

  return {
    customers: (customersResult.data ?? []).map((customer) => ({
      id: customer.id,
      customerNumber: customer.customer_number,
      loyaltyCardCode: customer.loyalty_card_code,
      fullName: customer.full_name,
      email: customer.email,
      phone: customer.phone,
      status: customer.status as "active" | "archived",
      points: pointBalanceByCustomer.get(customer.id) ?? 0,
    })),
    segments: (segmentsResult.data ?? []) as CustomerSegmentOption[],
    program: programResult.data
      ? {
          isEnabled: programResult.data.is_enabled,
          earnSpendMinor: programResult.data.earn_spend_minor,
          earnPoints: programResult.data.earn_points,
          redemptionValueMinor: programResult.data.redemption_value_minor,
          minimumRedemptionPoints: programResult.data.minimum_redemption_points,
        }
      : null,
  };
}

export async function loadCustomerProfile(
  context: BusinessContext,
  customerId: string,
): Promise<CustomerProfileWorkspace | null> {
  const supabase = await createClient();
  const [customerResult, summaryResult, historyResult, transactionsResult, cardsResult, cardEventsResult, segmentsResult, membershipsResult] = await Promise.all([
    supabase
      .from("customers")
      .select("id, customer_number, loyalty_card_code, full_name, email, phone, address, birthday, notes, status, created_at")
      .eq("organization_id", context.organization.id)
      .eq("id", customerId)
      .maybeSingle(),
    supabase.rpc("get_customer_summary", {
      target_organization_id: context.organization.id,
      target_customer_id: customerId,
    }),
    supabase.rpc("get_customer_purchase_history", {
      target_organization_id: context.organization.id,
      target_customer_id: customerId,
      target_limit: 25,
    }),
    supabase
      .from("loyalty_transactions")
      .select("id, entry_type, points_delta, note, created_at")
      .eq("organization_id", context.organization.id)
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.rpc("get_customer_loyalty_cards", {
      target_organization_id: context.organization.id,
      target_customer_id: customerId,
    }),
    supabase.rpc("get_customer_loyalty_card_events", {
      target_organization_id: context.organization.id,
      target_customer_id: customerId,
    }),
    supabase
      .from("customer_segments")
      .select("id, name, description")
      .eq("organization_id", context.organization.id)
      .order("name", { ascending: true }),
    supabase
      .from("customer_segment_memberships")
      .select("segment_id")
      .eq("organization_id", context.organization.id)
      .eq("customer_id", customerId),
  ]);

  if (!customerResult.data) return null;

  const error = [summaryResult, historyResult, transactionsResult, cardsResult, cardEventsResult, segmentsResult, membershipsResult].find((result) => result.error)?.error;
  if (error) throw new Error(`Unable to load customer profile: ${error.message}`);

  const row = customerResult.data;
  const customer: CustomerProfile = {
    id: row.id,
    customerNumber: row.customer_number,
    loyaltyCardCode: row.loyalty_card_code,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    birthday: row.birthday,
    notes: row.notes,
    status: row.status as "active" | "archived",
    createdAt: row.created_at,
  };

  const summaryRow = summaryResult.data?.[0];
  const summary: CustomerSummary | null = summaryRow
    ? {
        loyaltyPoints: summaryRow.loyalty_points ?? 0,
        saleCount: summaryRow.sale_count ?? 0,
        lifetimeSpendMinor: summaryRow.lifetime_spend_minor ?? 0,
        averageSaleMinor: summaryRow.average_sale_minor ?? 0,
        lastPurchaseAt: summaryRow.last_purchase_at ?? null,
      }
    : null;

  const history: CustomerPurchase[] = (historyResult.data ?? []).map((sale) => ({
    saleId: sale.sale_id,
    storeName: sale.store_name,
    receiptNumber: sale.receipt_number ?? null,
    completedAt: sale.completed_at,
    loyaltyPointsEarned: sale.loyalty_points_earned ?? null,
    loyaltyPointsRedeemed: sale.loyalty_points_redeemed ?? null,
    totalMinor: sale.total_minor,
    currencyCode: sale.currency_code,
  }));

  const ledger: CustomerLedgerEntry[] = (transactionsResult.data ?? []).map((transaction) => ({
    id: transaction.id,
    entryType: transaction.entry_type,
    pointsDelta: transaction.points_delta,
    note: transaction.note,
    createdAt: transaction.created_at,
  }));

  const loyaltyCards: LoyaltyCard[] = (cardsResult.data ?? []).map((card) => ({
    id: card.card_id,
    cardCode: card.card_code,
    status: card.status as LoyaltyCard["status"],
    stampCount: card.stamp_count,
    stampTarget: card.stamp_target,
    issuedAt: card.issued_at,
    expiresAt: card.expires_at ?? null,
    deactivatedAt: card.deactivated_at ?? null,
    deactivationReason: card.deactivation_reason ?? null,
  }));

  const loyaltyCardEvents: LoyaltyCardEvent[] = (cardEventsResult.data ?? []).map((event) => ({
    id: event.event_id,
    loyaltyCardId: event.loyalty_card_id,
    cardCode: event.card_code,
    eventType: event.event_type as LoyaltyCardEvent["eventType"],
    stampCountBefore: event.stamp_count_before,
    stampDelta: event.stamp_delta,
    stampCountAfter: event.stamp_count_after,
    saleId: event.sale_id ?? null,
    reason: event.reason ?? null,
    createdAt: event.created_at,
  }));

  return {
    customer,
    summary,
    history,
    ledger,
    loyaltyCards,
    loyaltyCardEvents,
    segments: (segmentsResult.data ?? []) as CustomerSegmentOption[],
    selectedSegmentIds: (membershipsResult.data ?? []).map((membership) => membership.segment_id),
  };
}
