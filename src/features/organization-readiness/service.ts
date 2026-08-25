import "server-only";

import { cookies } from "next/headers";

import {
  lifecycleInputSchema,
  organizationIdSchema,
} from "@/features/organization-readiness/organization-readiness-schema";
import type {
  OrganizationReadinessActionResult,
  OrganizationUsageResult,
  OrganizationUsageSnapshot,
} from "@/features/organization-readiness/organization-readiness-types";
import { requireUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

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

export async function setActiveOrganization(
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

  return { ok: true, message: "Active organization changed." };
}

export async function manageOrganizationLifecycle(
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

  const messages = {
    SUSPEND: "Organization suspended. Selling and Back Office operations are now paused.",
    RESUME: "Organization resumed. Normal operations are available again.",
    REQUEST_ARCHIVE: "Archive requested. Download a fresh export before permanently archiving this organization.",
    CANCEL_ARCHIVE: "Archive request cancelled. The organization remains available.",
    ARCHIVE: "Organization archived safely. Historical records were retained and no data was deleted.",
  } as const;

  return { ok: true, message: messages[parsed.data.action], status: result.status };
}

export async function getOrganizationUsage(
  organizationId: string,
): Promise<OrganizationUsageResult> {
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
