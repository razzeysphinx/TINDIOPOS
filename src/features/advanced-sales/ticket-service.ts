import "server-only";

import {
  posDeviceRequestHeaders,
} from "@/features/devices/device-schema";
import {
  cancelOpenTicketSchema,
  mergeOpenTicketsSchema,
  moveOpenTicketLinesSchema,
  saveOpenTicketSchema,
  splitOpenTicketSchema,
  type TicketActionResult,
  type TicketCartLineValues,
  type TicketMutationResult,
  type TicketReallocationLines,
} from "@/features/advanced-sales/ticket-schema";
import { hasPermission, type BusinessContext } from "@/lib/auth/dal";
import type { Json } from "@/lib/supabase/database.types";
import { createBusinessContextClient } from "@/lib/supabase/context-client";

export type {
  TicketActionResult,
  TicketMutationResult,
} from "@/features/advanced-sales/ticket-schema";

function databaseMessage(error: { code?: string; message?: string } | null) {
  if (error?.code === "42501" && error.message?.toLowerCase().includes("device")) return error.message;
  if (error?.code === "42501") return "You do not have permission to change these tickets.";
  if (error?.code === "23514" && error.message) return error.message;
  return "TINDIO could not save the ticket change. Nothing was moved.";
}

function hasTicketContext(context: BusinessContext) {
  return hasPermission(context, "pos.access")
    && hasPermission(context, "sales.create")
    && hasPermission(context, "tickets.manage")
    && context.features.open_tickets;
}

function ticketCart(
  lines: TicketCartLineValues[],
): Json {
  return lines.map((line) => ({
    product_id: line.productId,
    variant_id: line.variantId,
    quantity: line.quantity,
    unit_price_minor: line.manualPriceMinor,
    modifier_option_ids: line.modifierOptionIds,
    ticket_line_id: line.ticketLineId,
    item_note: line.itemNote || null,
    productName: line.productName,
    variantName: line.variantName,
    sku: line.sku,
    barcode: line.barcode,
    categoryId: line.categoryId,
    priceMinor: line.priceMinor,
    unit: line.unit,
    imageUrl: line.imageUrl ?? null,
    isVariablePrice: line.isVariablePrice,
    allowFractionalQuantity: line.allowFractionalQuantity,
    manualPriceMinor: line.manualPriceMinor,
    modifiers: line.modifiers ?? [],
  })) as Json;
}

function reallocationLines(
  lines: TicketReallocationLines,
): Json {
  return lines.map((line) => ({
    ticket_line_id: line.ticketLineId,
    quantity: line.quantity,
  })) as Json;
}

export async function saveOpenTicket({ context, input }: { context: BusinessContext; input: unknown }): Promise<TicketActionResult> {
  const parsed = saveOpenTicketSchema.safeParse(input);
  if (!hasTicketContext(context) || !parsed.success || !context.storeIds.includes(parsed.data.storeId)) {
    return { ok: false, message: "Check the ticket details and your store access." };
  }

  const data = parsed.data;
  const supabase = await createBusinessContextClient(context, { headers: posDeviceRequestHeaders(data.device) });
  const { data: ticket, error } = await supabase.rpc("save_open_ticket_v2", {
    target_organization_id: context.organization.id,
    target_store_id: data.storeId,
    target_register_id: data.registerId,
    target_ticket_id: (data.ticketId ?? null) as never,
    target_customer_id: (data.customerId ?? null) as never,
    target_dining_option_id: (data.diningOptionId ?? null) as never,
    target_assigned_employee_id: (data.assignedEmployeeId ?? null) as never,
    target_label: data.label,
    target_note: data.note || null as never,
    target_cart: ticketCart(data.cart),
  });
  if (error || !ticket?.[0]) return { ok: false, message: databaseMessage(error) };
  return { ok: true, ticketId: ticket[0].ticket_id, message: "Ticket saved." };
}

export async function cancelOpenTicket({ context, input }: { context: BusinessContext; input: unknown }): Promise<TicketMutationResult> {
  const parsed = cancelOpenTicketSchema.safeParse(input);
  if (!hasTicketContext(context) || !parsed.success) return { ok: false, message: "This ticket is unavailable." };
  const database = await createBusinessContextClient(context, { headers: posDeviceRequestHeaders(parsed.data.device) }) as unknown as {
    rpc: (name: string, args: Record<string, string>) => Promise<{ error: { code?: string; message?: string } | null }>;
  };
  const { error } = await database.rpc("cancel_open_ticket", {
    target_organization_id: context.organization.id,
    target_ticket_id: parsed.data.ticketId,
  });
  if (error) return { ok: false, message: databaseMessage(error) };
  return { ok: true, message: "Ticket cancelled." };
}

export async function moveOpenTicketLines({ context, input }: { context: BusinessContext; input: unknown }): Promise<TicketMutationResult> {
  const parsed = moveOpenTicketLinesSchema.safeParse(input);
  if (!hasTicketContext(context) || !parsed.success) return { ok: false, message: "Choose valid source, destination, and ticket lines." };
  const { error } = await (await createBusinessContextClient(context, { headers: posDeviceRequestHeaders(parsed.data.device) })).rpc("move_open_ticket_lines", {
    target_organization_id: context.organization.id,
    target_source_ticket_id: parsed.data.sourceTicketId,
    target_destination_ticket_id: parsed.data.destinationTicketId,
    target_lines: reallocationLines(parsed.data.lines),
  });
  if (error) return { ok: false, message: databaseMessage(error) };
  return { ok: true, message: "Selected items moved to the destination ticket." };
}

export async function splitOpenTicket({ context, input }: { context: BusinessContext; input: unknown }): Promise<TicketActionResult> {
  const parsed = splitOpenTicketSchema.safeParse(input);
  if (!hasTicketContext(context) || !parsed.success) return { ok: false, message: "Enter a name and choose valid ticket items." };
  const { data: ticketId, error } = await (await createBusinessContextClient(context, { headers: posDeviceRequestHeaders(parsed.data.device) })).rpc("split_open_ticket", {
    target_organization_id: context.organization.id,
    target_source_ticket_id: parsed.data.sourceTicketId,
    target_label: parsed.data.label,
    target_lines: reallocationLines(parsed.data.lines),
  });
  if (error || !ticketId) return { ok: false, message: databaseMessage(error) };
  return { ok: true, ticketId, message: "A new ticket was created from the selected items." };
}

export async function mergeOpenTickets({ context, input }: { context: BusinessContext; input: unknown }): Promise<TicketMutationResult> {
  const parsed = mergeOpenTicketsSchema.safeParse(input);
  if (!hasTicketContext(context) || !parsed.success) return { ok: false, message: "Choose two different open tickets." };
  const { error } = await (await createBusinessContextClient(context, { headers: posDeviceRequestHeaders(parsed.data.device) })).rpc("merge_open_tickets", {
    target_organization_id: context.organization.id,
    target_source_ticket_id: parsed.data.sourceTicketId,
    target_destination_ticket_id: parsed.data.destinationTicketId,
  });
  if (error) return { ok: false, message: databaseMessage(error) };
  return { ok: true, message: "Tickets merged. The original source ticket remains in the audit history." };
}
