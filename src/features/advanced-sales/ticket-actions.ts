"use server";

import { revalidatePath } from "next/cache";

import {
  mergeOpenTickets,
  splitOpenTicket,
  type TicketActionResult,
  type TicketMutationResult,
} from "@/features/advanced-sales/ticket-service";
import { requireBusinessContext } from "@/lib/auth/dal";

export type { TicketActionResult } from "@/features/advanced-sales/ticket-service";

function revalidateTickets() {
  revalidatePath("/pos");
}

export async function splitOpenTicketAction(input: unknown): Promise<TicketActionResult> {
  const context = await requireBusinessContext();
  const result = await splitOpenTicket({ context, input });
  if (result.ok) revalidateTickets();
  return result;
}

export async function mergeOpenTicketsAction(input: unknown): Promise<TicketMutationResult> {
  const context = await requireBusinessContext();
  const result = await mergeOpenTickets({ context, input });
  if (result.ok) revalidateTickets();
  return result;
}
