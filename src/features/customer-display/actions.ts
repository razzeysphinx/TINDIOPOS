"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  createCustomerDisplayRealtimeTopic,
  createCustomerDisplayToken,
  hashCustomerDisplayToken,
} from "@/features/customer-display/customer-display-token";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { getPublicEnvironment } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

const provisionSchema = z.object({ registerId: z.uuid() });

export type CustomerDisplayActionResult =
  | { ok: true; message: string; displayUrl: string }
  | { ok: false; message: string };

export async function provisionCustomerDisplayAction(
  input: unknown,
): Promise<CustomerDisplayActionResult> {
  const context = await requireBusinessContext();

  if (!context.features.customer_display) {
    return { ok: false, message: "Customer display is disabled for this business." };
  }

  if (!hasPermission(context, "registers.manage")) {
    return { ok: false, message: "You do not have permission to manage customer displays." };
  }

  const parsed = provisionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Choose a valid register." };
  }

  const displayToken = createCustomerDisplayToken();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("provision_customer_display_session", {
    target_organization_id: context.organization.id,
    target_register_id: parsed.data.registerId,
    target_access_token_hash: hashCustomerDisplayToken(displayToken),
    target_realtime_topic: createCustomerDisplayRealtimeTopic(),
  });

  if (error || !data?.[0]?.session_id) {
    return {
      ok: false,
      message: error?.code === "42501"
        ? "You do not have permission to manage customer displays."
        : "TINDIO could not create the customer display link.",
    };
  }

  const baseUrl = getPublicEnvironment().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  revalidatePath("/back-office/registers");

  return {
    ok: true,
    message: "Customer display link created. Copy it to the connected display now.",
    displayUrl: `${baseUrl}/customer-display/${displayToken}`,
  };
}
