"use server";

import { revalidatePath } from "next/cache";

import {
  mergeOpenTickets,
  type TicketMutationResult,
} from "@/features/advanced-sales/ticket-service";
import { requireBusinessContext } from "@/lib/auth/dal";

export type { TicketActionResult } from "@/features/advanced-sales/ticket-service";

function revalidateTickets() {
  revalidatePath("/pos");
}

export async function mergeOpenTicketsAction(input: unknown): Promise<TicketMutationResult> {
  const context = await requireBusinessContext();
  const result = await mergeOpenTickets({ context, input });
  if (result.ok) revalidateTickets();
  return result;
}
