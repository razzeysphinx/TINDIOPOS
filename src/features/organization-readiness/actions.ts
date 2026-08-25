"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";

import { requireUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

const organizationIdSchema = z.string().uuid();
const lifecycleInputSchema = z.object({
  organizationId: z.string().uuid(),
  action: z.enum(["SUSPEND", "RESUME", "REQUEST_ARCHIVE", "CANCEL_ARCHIVE", "ARCHIVE"]),
  reason: z.string().trim().max(500).optional(),
});

export type OrganizationUsageSnapshot = {
  usage_date: string;
  active_store_count: number;
  active_employee_count: number;
  active_product_count: number;
  customer_count: number;
  completed_sale_count: number;
  completed_sales_total_minor: number;
  pending_offline_sync_count: number;
  captured_at: string;
};

export type OrganizationReadinessActionResult =
  | { ok: true; message: string; status?: "active" | "suspended" | "archived" }
  | { ok: false; message: string; retryAfterSeconds?: number };

function revalidateOrganizationViews() {
  revalidatePath("/", "layout");
  revalidatePath("/back-office", "layout");
  revalidatePath("/back-office/business-profile");
  revalidatePath("/organization-paused");
  revalidatePath("/pos");
  revalidatePath("/kitchen");
}

async function ensureOwnActiveMembership(organizationId: string) {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employees")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return { user, supabase };
}

export async function selectActiveOrganizationAction(
  organizationId: string,
): Promise<OrganizationReadinessActionResult> {
  const parsedOrganizationId = organizationIdSchema.safeParse(organizationId);

  if (!parsedOrganizationId.success) {
    return { ok: false, message: "Choose a valid organization." };
  }

  const membership = await ensureOwnActiveMembership(parsedOrganizationId.data);

  if (!membership) {
    return { ok: false, message: "You do not have access to that organization." };
  }

  const cookieStore = await cookies();
  cookieStore.set("tindio-active-organization", parsedOrganizationId.data, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  revalidateOrganizationViews();
  return { ok: true, message: "Active organization changed." };
}

export async function manageOrganizationLifecycleAction(
  input: unknown,
): Promise<OrganizationReadinessActionResult> {
  const parsed = lifecycleInputSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Choose a valid organization lifecycle action." };
  }

  const membership = await ensureOwnActiveMembership(parsed.data.organizationId);

  if (!membership) {
    return { ok: false, message: "You do not have access to that organization." };
  }

  const { data, error } = await membership.supabase.rpc("manage_organization_lifecycle", {
    target_organization_id: parsed.data.organizationId,
    target_action: parsed.data.action,
    target_reason: parsed.data.reason?.trim() || undefined,
  });

  if (error) {
    return {
      ok: false,
      message: error.code === "42501"
        ? "Only an organization owner can change this lifecycle."
        : error.code === "22023"
          ? error.message
          : "TINDIO could not change the organization lifecycle. No data was deleted.",
    };
  }

  const result = data as { allowed?: boolean; retry_after_seconds?: number; status?: "active" | "suspended" | "archived" } | null;

  if (!result?.allowed) {
    return {
      ok: false,
      message: "Too many lifecycle changes were requested. Please try again later.",
      retryAfterSeconds: result?.retry_after_seconds,
    };
  }

  revalidateOrganizationViews();

  const messages = {
    SUSPEND: "Organization suspended. Selling and Back Office operations are now paused.",
    RESUME: "Organization resumed. Normal operations are available again.",
    REQUEST_ARCHIVE: "Archive requested. Download a fresh export before permanently archiving this organization.",
    CANCEL_ARCHIVE: "Archive request cancelled. The organization remains available.",
    ARCHIVE: "Organization archived safely. Historical records were retained and no data was deleted.",
  } as const;

  return { ok: true, message: messages[parsed.data.action], status: result.status };
}

export async function getOrganizationUsageAction(
  organizationId: string,
): Promise<
  | { ok: true; usage: OrganizationUsageSnapshot }
  | { ok: false; message: string }
> {
  const parsedOrganizationId = organizationIdSchema.safeParse(organizationId);

  if (!parsedOrganizationId.success) {
    return { ok: false, message: "Choose a valid organization." };
  }

  const membership = await ensureOwnActiveMembership(parsedOrganizationId.data);

  if (!membership) {
    return { ok: false, message: "You do not have access to that organization." };
  }

  const { data, error } = await membership.supabase.rpc("get_organization_usage_snapshot", {
    target_organization_id: parsedOrganizationId.data,
  });

  if (error || !data) {
    return {
      ok: false,
      message: error?.code === "42501"
        ? "Only an owner or administrator can view organization usage."
        : "TINDIO could not load the organization usage snapshot.",
    };
  }

  return { ok: true, usage: data as OrganizationUsageSnapshot };
}
