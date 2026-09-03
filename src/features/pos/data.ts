/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";

import type { PosCustomerDisplaySession } from "@/features/customer-display/customer-display-types";
import type { TimeClockEntry } from "@/features/time-clock/time-clock-types";
import {
  hasPermission,
  type BusinessContext,
} from "@/lib/auth/dal";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import type {
  PosActiveShift,
  PosCatalogItem,
  PosDiscount,
  PosDiningOption,
  PosLoyaltyProgram,
  PosOpenTicket,
  PosPaymentMethod,
  PosRegister,
  PosTaxRate,
  PosTicketAssignee,
  PosTicketTemplate,
} from "@/features/pos/pos-types";

export type PosPageData = {
  stores: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; color: string | null }>;
  registers: PosRegister[];
  paymentMethods: PosPaymentMethod[];
  loyaltyProgram: PosLoyaltyProgram | null;
  discounts: PosDiscount[];
  taxRates: PosTaxRate[];
  diningOptions: PosDiningOption[];
  ticketTemplates: PosTicketTemplate[];
  customerDisplaySessions: PosCustomerDisplaySession[];
  timeClockEntry: TimeClockEntry | null;
  activeShift: PosActiveShift | null;
  initialItems: PosCatalogItem[];
  initialFavoriteItems: PosCatalogItem[];
  initialRecentItems: PosCatalogItem[];
  openTickets: PosOpenTicket[];
  ticketAssignees: PosTicketAssignee[];
};

export type PosReceiptSummary = {
  receipt_id: string;
  sale_id: string;
  receipt_number: number;
  issued_at: string;
  store_id: string;
  register_id: string;
  store_name: string;
  register_name: string;
  cashier_name: string;
  total_minor: number;
  currency_code: string;
  refund_total_minor: number;
  refund_count: number;
  has_refundable_quantity: boolean;
  payment_methods: Array<{
    name: string;
    type: "CASH" | "CARD" | "E_WALLET" | "BANK_TRANSFER" | "VOUCHER" | "OTHER";
  }>;
};

export type PosReceiptDetail = {
  receipt: { id: string; number: number; issuedAt: string; layout: Json | null };
  customerEmail: string | null;
  sale: {
    id: string;
    storeId: string;
    registerId: string;
    currencyCode: string;
    organizationName: string;
    storeName: string;
    registerName: string;
    cashierName: string;
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    totalMinor: number;
  };
  items: Array<{ id: string; name: string; sku: string | null; quantity: number; unit: string; unitPriceMinor: number; lineTotalMinor: number }>;
  payments: Array<{ id: string; name: string; type: "CASH" | "CARD" | "E_WALLET" | "BANK_TRANSFER" | "VOUCHER" | "OTHER"; amountMinor: number; tenderedMinor: number | null; changeMinor: number | null; referenceNumber: string | null }>;
  refunds: Array<{
    id: string;
    number: number;
    totalMinor: number;
    completedAt: string;
    reason: string;
    paymentName: string | null;
    paymentReference: string | null;
    items: Array<{ id: string; saleItemId: string; name: string; quantity: number; unit: string; lineTotalMinor: number }>;
  }>;
};

type PosReceiptRpc = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

// Canonical server-side mapping from `search_pos_catalog` /
// `get_pos_favorite_items` / `get_pos_recent_items` rows to the shared
// PosCatalogItem DTO. Used by both the POS workspace loader and the
// /api/pos/catalog route so the transport shapes cannot drift apart.
export type PosCatalogRow = {
  product_id: string;
  variant_id: string | null;
  category_id: string | null;
  product_name: string;
  variant_name: string | null;
  sku: string | null;
  barcode: string | null;
  price_minor: number;
  unit: string;
  image_url: string | null;
  is_variable_price: boolean;
  allow_fractional_quantity: boolean;
};

export function mapPosCatalogItems(
  rows: Array<PosCatalogRow>,
  modifierProductIds: Set<string>,
  modifiersEnabled: boolean,
): PosCatalogItem[] {
  return rows.map((item) => ({
    productId: item.product_id,
    variantId: item.variant_id,
    categoryId: item.category_id,
    productName: item.product_name,
    variantName: item.variant_name,
    sku: item.sku,
    barcode: item.barcode,
    priceMinor: item.price_minor,
    unit: item.unit,
    imageUrl: item.image_url,
    isVariablePrice: item.is_variable_price,
    allowFractionalQuantity: item.allow_fractional_quantity,
    hasModifiers: modifiersEnabled && modifierProductIds.has(item.product_id),
  }));
}

export async function loadPosWorkspace(
  context: BusinessContext,
): Promise<PosPageData> {
  const features = context.features;
  const canAssignTickets = hasPermission(context, "employees.manage");
  const canUseOpenTickets = features.open_tickets && hasPermission(context, "tickets.manage");
  const supabase = await createClient();
  const database = supabase as unknown as { from: (table: string) => any };
  const [storesResult, categoriesResult, registersResult, paymentMethodsResult, storePaymentMethodsResult, openShiftsResult, loyaltyProgramResult, discountsResult, taxRatesResult, diningOptionsResult, ticketTemplatesResult, customerDisplaySessionsResult, timeClockResult] = await Promise.all([
    supabase
      .from("stores")
      .select("id, name")
      .eq("organization_id", context.organization.id)
      .eq("is_active", true)
      .in("id", context.storeIds)
      .order("created_at", { ascending: true }),
    supabase
      .from("categories")
      .select("id, name, color")
      .eq("organization_id", context.organization.id)
      .eq("is_archived", false)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("registers")
      .select("id, store_id, name, code")
      .eq("organization_id", context.organization.id)
      .eq("is_active", true)
      .in("store_id", context.storeIds)
      .order("name", { ascending: true }),
    supabase
      .from("payment_methods")
      .select("id, name, code, payment_type, offline_policy, requires_reference, sort_order, is_loyalty_redemption")
      .eq("organization_id", context.organization.id)
      .eq("is_enabled", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("store_payment_methods")
      .select("store_id, payment_method_id")
      .eq("organization_id", context.organization.id)
      .eq("is_enabled", true)
      .in("store_id", context.storeIds),
    supabase
      .from("shifts")
      .select("id, store_id, register_id, opening_cash_minor, opened_at")
      .eq("organization_id", context.organization.id)
      .eq("opened_by_employee_id", context.employee.id)
      .eq("status", "open")
      .limit(1),
    supabase
      .from("loyalty_programs")
      .select("is_enabled, earn_spend_minor, earn_points, redemption_value_minor, minimum_redemption_points")
      .eq("organization_id", context.organization.id)
      .maybeSingle(),
    database.from("discounts").select("id, name, discount_type, percentage_bps, amount_minor").eq("organization_id", context.organization.id).eq("is_active", true).order("sort_order", { ascending: true }).order("name", { ascending: true }),
    database.from("tax_rates").select("id, name, rate_bps, is_inclusive, is_default").eq("organization_id", context.organization.id).eq("is_active", true).order("name", { ascending: true }),
    database.from("dining_options").select("id, name, is_default").eq("organization_id", context.organization.id).eq("is_active", true).order("sort_order", { ascending: true }).order("name", { ascending: true }),
    supabase.from("ticket_templates").select("id, label, note, dining_option_id").eq("organization_id", context.organization.id).eq("is_active", true).order("sort_order", { ascending: true }).order("label", { ascending: true }),
    features.customer_display
      ? supabase.rpc("get_pos_customer_display_sessions_with_ids", {
          target_organization_id: context.organization.id,
        })
      : Promise.resolve({ data: [], error: null }),
    features.time_clock
      ? supabase.rpc("get_current_time_clock_entry", {
          target_organization_id: context.organization.id,
        })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const baseError = [
    storesResult,
    categoriesResult,
    registersResult,
    paymentMethodsResult,
    storePaymentMethodsResult,
    openShiftsResult,
    loyaltyProgramResult,
    discountsResult,
    taxRatesResult,
    diningOptionsResult,
    ticketTemplatesResult,
    customerDisplaySessionsResult,
    timeClockResult,
  ].find(
    (result) => result.error,
  )?.error;

  if (baseError) {
    throw new Error(`Unable to open the POS: ${baseError.message}`);
  }

  const stores = storesResult.data ?? [];
  const categories = categoriesResult.data ?? [];
  const registers: PosRegister[] = (registersResult.data ?? []).map((register) => ({
    id: register.id,
    storeId: register.store_id,
    name: register.name,
    code: register.code,
  }));
  const methodsById = new Map(
    (paymentMethodsResult.data ?? []).map((method) => [method.id, method]),
  );
  const paymentMethods: PosPaymentMethod[] = (storePaymentMethodsResult.data ?? [])
    .flatMap((storeMethod) => {
      const method = methodsById.get(storeMethod.payment_method_id);
      if (!method || method.is_loyalty_redemption) return [];

      return [{
        id: method.id,
        storeId: storeMethod.store_id,
        name: method.name,
        code: method.code,
        type: method.payment_type as PosPaymentMethod["type"],
        offlinePolicy: method.offline_policy as PosPaymentMethod["offlinePolicy"],
        requiresReference: method.requires_reference,
        sortOrder: method.sort_order,
      }];
    })
    .sort(
      (left, right) =>
        left.storeId.localeCompare(right.storeId) ||
        left.sortOrder - right.sortOrder ||
      left.name.localeCompare(right.name),
    );
  const activeShiftRow = openShiftsResult.data?.[0];
  const loyaltyProgram: PosLoyaltyProgram | null = loyaltyProgramResult.data
    ? {
        isEnabled: loyaltyProgramResult.data.is_enabled,
        earnSpendMinor: loyaltyProgramResult.data.earn_spend_minor,
        earnPoints: loyaltyProgramResult.data.earn_points,
        redemptionValueMinor: loyaltyProgramResult.data.redemption_value_minor,
        minimumRedemptionPoints: loyaltyProgramResult.data.minimum_redemption_points,
      }
    : null;
  const activeShift: PosActiveShift | null = activeShiftRow
    ? {
        id: activeShiftRow.id,
        storeId: activeShiftRow.store_id,
        registerId: activeShiftRow.register_id,
        openingCashMinor: activeShiftRow.opening_cash_minor,
        openedAt: activeShiftRow.opened_at,
      }
    : null;
  const timeClockEntry: TimeClockEntry | null = timeClockResult.data?.[0]
    ? {
        id: timeClockResult.data[0].entry_id,
        employeeId: context.employee.id,
        employeeName: context.profile.full_name || context.profile.email || context.employee.employee_number,
        storeId: timeClockResult.data[0].store_id,
        storeName: stores.find((store) => store.id === timeClockResult.data[0].store_id)?.name ?? "Assigned store",
        clockedInAt: timeClockResult.data[0].clocked_in_at,
      }
    : null;
  const discounts: PosDiscount[] = (discountsResult.data ?? []).map((discount: any) => ({ id: discount.id, name: discount.name, discountType: discount.discount_type, percentageBps: discount.percentage_bps, amountMinor: discount.amount_minor }));
  const taxRates: PosTaxRate[] = (taxRatesResult.data ?? []).map((tax: any) => ({ id: tax.id, name: tax.name, rateBps: tax.rate_bps, isInclusive: tax.is_inclusive, isDefault: tax.is_default }));
  const diningOptions: PosDiningOption[] = (diningOptionsResult.data ?? []).map((option: any) => ({ id: option.id, name: option.name, isDefault: option.is_default }));
  const ticketTemplates: PosTicketTemplate[] = (ticketTemplatesResult.data ?? []).map((template) => ({ id: template.id, label: template.label, note: template.note, diningOptionId: template.dining_option_id }));
  const customerDisplaySessions: PosCustomerDisplaySession[] = (customerDisplaySessionsResult.data ?? []).map((session) => ({
    sessionId: session.session_id,
    registerId: session.register_id,
    realtimeTopic: session.realtime_topic,
  }));

  let initialItems: PosCatalogItem[] = [];
  let initialFavoriteItems: PosCatalogItem[] = [];
  let initialRecentItems: PosCatalogItem[] = [];
  let openTickets: PosOpenTicket[] = [];
  let ticketAssignees: PosTicketAssignee[] = [];

  if (activeShift) {
    const [catalogResult, favoriteResult, recentResult, ticketsResult, assigneesResult] = await Promise.all([
      supabase.rpc("search_pos_catalog", {
        target_organization_id: context.organization.id,
        target_store_id: activeShift.storeId,
        target_query: undefined,
        target_category_id: undefined,
        target_offset: 0,
        target_limit: 24,
      }),
      supabase.rpc("get_pos_favorite_items", {
        target_organization_id: context.organization.id,
        target_store_id: activeShift.storeId,
      }),
      supabase.rpc("get_pos_recent_items", {
        target_organization_id: context.organization.id,
        target_store_id: activeShift.storeId,
        target_limit: 12,
      }),
      canUseOpenTickets
        ? supabase.rpc("get_pos_open_tickets", {
            target_organization_id: context.organization.id,
            target_store_id: activeShift.storeId,
            target_register_id: activeShift.registerId,
          })
        : Promise.resolve({ data: [], error: null }),
      canAssignTickets && canUseOpenTickets
        ? supabase.rpc("get_pos_ticket_assignees", {
            target_organization_id: context.organization.id,
            target_store_id: activeShift.storeId,
          })
        : Promise.resolve({ data: [], error: null }),
    ]);

    const workspaceError = [catalogResult, favoriteResult, recentResult, ticketsResult, assigneesResult].find(
      (result) => result.error,
    )?.error;
    if (workspaceError) {
      throw new Error(`Unable to load the POS workspace: ${workspaceError.message}`);
    }

    const workspaceRows = [
      ...(catalogResult.data ?? []),
      ...(favoriteResult.data ?? []),
      ...(recentResult.data ?? []),
    ];
    const productIds = [...new Set(workspaceRows.map((item) => item.product_id))];
    const { data: modifierAssignments, error: modifierError } = features.modifiers && productIds.length > 0
      ? await database
          .from("product_modifier_groups")
          .select("product_id")
          .eq("organization_id", context.organization.id)
          .in("product_id", productIds)
      : { data: [], error: null };
    if (modifierError) {
      throw new Error(`Unable to load POS modifiers: ${modifierError.message}`);
    }
    const modifierProductIds = new Set<string>(
      (modifierAssignments ?? []).map((assignment: { product_id: string }) => assignment.product_id),
    );

    initialItems = mapPosCatalogItems(catalogResult.data ?? [], modifierProductIds, features.modifiers);
    initialFavoriteItems = mapPosCatalogItems(favoriteResult.data ?? [], modifierProductIds, features.modifiers);
    initialRecentItems = mapPosCatalogItems(recentResult.data ?? [], modifierProductIds, features.modifiers);
    ticketAssignees = (assigneesResult.data ?? []).map((assignee: any) => ({ id: assignee.employee_id, fullName: assignee.full_name }));
    openTickets = (ticketsResult.data ?? []).flatMap((ticket: any) => {
      if (!Array.isArray(ticket.cart)) return [];
      const cart = ticket.cart.flatMap((line: any) => line && typeof line === "object" && typeof line.product_id === "string" ? [{ productId: line.product_id, variantId: typeof line.variant_id === "string" ? line.variant_id : null, quantity: Number(line.quantity), modifierOptionIds: Array.isArray(line.modifier_option_ids) ? line.modifier_option_ids.filter((id: unknown): id is string => typeof id === "string") : [], productName: typeof line.productName === "string" ? line.productName : "Saved item", variantName: typeof line.variantName === "string" ? line.variantName : null, sku: typeof line.sku === "string" ? line.sku : null, barcode: typeof line.barcode === "string" ? line.barcode : null, categoryId: typeof line.categoryId === "string" ? line.categoryId : null, priceMinor: typeof line.priceMinor === "number" ? line.priceMinor : 0, unit: typeof line.unit === "string" ? line.unit : "each", imageUrl: typeof line.imageUrl === "string" ? line.imageUrl : null, isVariablePrice: line.isVariablePrice === true, allowFractionalQuantity: line.allowFractionalQuantity === true, manualPriceMinor: typeof line.manualPriceMinor === "number" ? line.manualPriceMinor : null, ticketLineId: typeof line.ticket_line_id === "string" ? line.ticket_line_id : undefined, itemNote: typeof line.item_note === "string" ? line.item_note : null, modifiers: Array.isArray(line.modifiers) ? line.modifiers : [] }] : []);
      const customer = typeof ticket.customer_id === "string" && typeof ticket.customer_full_name === "string" ? { id: ticket.customer_id, customerNumber: Number(ticket.customer_number), loyaltyCardCode: typeof ticket.loyalty_card_code === "string" ? ticket.loyalty_card_code : "", fullName: ticket.customer_full_name, phone: typeof ticket.customer_phone === "string" ? ticket.customer_phone : null, email: typeof ticket.customer_email === "string" ? ticket.customer_email : null, loyaltyPoints: Number(ticket.customer_loyalty_points) || 0 } : null;
      return cart.length ? [{ id: ticket.ticket_id, label: ticket.label, note: ticket.note, customer, diningOptionId: ticket.dining_option_id, assignedEmployeeId: ticket.assigned_employee_id, cart, updatedAt: ticket.updated_at }] : [];
    });
  }

  return {
    stores,
    categories,
    registers,
    paymentMethods,
    loyaltyProgram,
    discounts,
    taxRates,
    diningOptions,
    ticketTemplates,
    customerDisplaySessions,
    timeClockEntry,
    activeShift,
    initialItems,
    initialFavoriteItems,
    initialRecentItems,
    openTickets,
    ticketAssignees,
  };
}

export async function loadPosReceiptHistory(
  context: BusinessContext,
  input: { beforeReceiptNumber?: number; query?: string } = {},
) {
  const supabase = await createClient();
  const database = supabase as unknown as PosReceiptRpc;
  const { data, error } = await database.rpc("get_pos_receipt_history", {
    target_organization_id: context.organization.id,
    target_query: input.query?.trim() || null,
    target_before_receipt_number: input.beforeReceiptNumber ?? null,
    target_limit: 25,
  });

  if (error) throw new Error(`Unable to load POS receipts: ${error.message}`);
  return Array.isArray(data) ? data as PosReceiptSummary[] : [];
}

export async function loadPosReceiptDetail(
  context: BusinessContext,
  receiptId: string,
) {
  const supabase = await createClient();
  const database = supabase as unknown as PosReceiptRpc;
  const { data, error } = await database.rpc("get_pos_receipt_detail", {
    target_organization_id: context.organization.id,
    target_receipt_id: receiptId,
  });

  if (error) throw new Error(`Unable to load POS receipt: ${error.message}`);
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data as PosReceiptDetail;
}
