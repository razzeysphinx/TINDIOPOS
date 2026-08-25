"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  acceptPendingInvitationSchema,
  invitationTokenSchema,
} from "@/features/management/management-schema";
import type { ManagementActionResult } from "@/features/management/management-types";
import { hashInvitationToken } from "@/features/management/invitation-token";
import {
  createEmployeeInvitation,
  createRegister,
  createRole,
  createStore,
  databaseMessage,
  revokeEmployeeInvitation,
  validationError,
} from "@/features/management/service";
import {
  getBusinessContext,
  hasPermission,
  requireBusinessContext,
  requireUser,
} from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export async function createStoreAction(
  input: unknown,
): Promise<ManagementActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "stores.manage")) {
    return { ok: false, message: "You do not have permission to create stores." };
  }

  const result = await createStore(context, input);

  if (result.ok) {
    revalidatePath("/back-office/stores");
    revalidatePath("/back-office");
  }

  return result;
}

export async function createRegisterAction(
  input: unknown,
): Promise<ManagementActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "registers.manage")) {
    return {
      ok: false,
      message: "You do not have permission to create registers.",
    };
  }

  const result = await createRegister(context, input);

  if (result.ok) {
    revalidatePath("/back-office/registers");
    revalidatePath("/back-office");
  }

  return result;
}

export async function createRoleAction(
  input: unknown,
): Promise<ManagementActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "roles.manage")) {
    return { ok: false, message: "You do not have permission to create roles." };
  }

  const result = await createRole(context, input);

  if (result.ok) {
    revalidatePath("/back-office/roles");
    revalidatePath("/back-office/employees");
    revalidatePath("/back-office");
  }

  return result;
}

export async function createEmployeeInvitationAction(
  input: unknown,
): Promise<ManagementActionResult<{ inviteUrl: string }>> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "employees.manage")) {
    return {
      ok: false,
      message: "You do not have permission to invite employees.",
    };
  }

  const result = await createEmployeeInvitation(context, input);

  if (result.ok) {
    revalidatePath("/back-office/employees");
  }

  return result;
}

export async function revokeEmployeeInvitationAction(
  input: unknown,
): Promise<ManagementActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "employees.manage")) {
    return { ok: false, message: "You do not have permission to revoke invitations." };
  }

  const result = await revokeEmployeeInvitation(context, input);

  if (result.ok) {
    revalidatePath("/back-office/employees");
  }

  return result;
}

// Deferred from the management layer split: these four entry points are the
// accept-invitation flow (join/auth path). They validate and consume
// hashed invitation tokens via the controlled `accept_employee_invitation`
// RPC. Their implementations are intentionally left untouched.
export async function acceptEmployeeInvitationAction(
  input: unknown,
): Promise<ManagementActionResult<{ redirectTo: string }>> {
  await requireUser();

  if (await getBusinessContext()) {
    return { ok: false, message: "This account already belongs to an organization." };
  }

  const parsed = invitationTokenSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_employee_invitation", {
    invitation_token_hash: hashInvitationToken(parsed.data),
  });

  if (error) {
    return {
      ok: false,
      message: databaseMessage(
        error.code,
        "The invitation is invalid, expired, or belongs to another email.",
      ),
    };
  }

  revalidatePath("/back-office", "layout");
  return {
    ok: true,
    message: "Invitation accepted.",
    data: { redirectTo: "/back-office" },
  };
}

export async function acceptEmployeeInvitationFormAction(
  _previousState: ManagementActionResult<{ redirectTo: string }> | null,
  formData: FormData,
): Promise<ManagementActionResult<{ redirectTo: string }> | null> {
  const result = await acceptEmployeeInvitationAction(formData.get("token"));

  if (!result.ok) {
    return result;
  }

  redirect(result.data?.redirectTo ?? "/back-office");
}

export async function acceptPendingEmployeeInvitationAction(
  input: unknown,
): Promise<ManagementActionResult<{ redirectTo: string }>> {
  const user = await requireUser();

  if (await getBusinessContext()) {
    return { ok: false, message: "This account already belongs to an organization." };
  }

  const parsed = acceptPendingInvitationSchema.safeParse(input);
  if (!parsed.success || !user.email) return validationError();

  const supabase = await createClient();
  const { data: invitation, error: invitationError } = await supabase
    .from("employee_invitations")
    .select("token_hash")
    .eq("id", parsed.data.invitationId)
    .eq("email", user.email.trim().toLowerCase())
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (invitationError || !invitation) {
    return {
      ok: false,
      message: "This invitation is no longer active or belongs to another email.",
    };
  }

  const { error } = await supabase.rpc("accept_employee_invitation", {
    invitation_token_hash: invitation.token_hash,
  });

  if (error) {
    return {
      ok: false,
      message: databaseMessage(
        error.code,
        "TINDIO could not attach the employee role. Ask your manager to recreate the invitation.",
      ),
    };
  }

  revalidatePath("/back-office", "layout");
  return {
    ok: true,
    message: "Invitation accepted.",
    data: { redirectTo: "/back-office" },
  };
}

export async function acceptPendingEmployeeInvitationFormAction(
  _previousState: ManagementActionResult<{ redirectTo: string }> | null,
  formData: FormData,
): Promise<ManagementActionResult<{ redirectTo: string }> | null> {
  const result = await acceptPendingEmployeeInvitationAction({
    invitationId: formData.get("invitationId"),
  });

  if (!result.ok) {
    return result;
  }

  redirect(result.data?.redirectTo ?? "/back-office");
}
