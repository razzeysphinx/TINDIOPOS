"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  acceptPendingInvitationSchema,
  createInvitationSchema,
  createRegisterSchema,
  createRoleSchema,
  createStoreSchema,
  invitationTokenSchema,
  revokeInvitationSchema,
} from "@/features/management/management-schema";
import {
  createInvitationToken,
  hashInvitationToken,
} from "@/features/management/invitation-token";
import {
  getBusinessContext,
  hasPermission,
  requireBusinessContext,
  requireUser,
} from "@/lib/auth/dal";
import { getPublicEnvironment } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type ManagementActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function validationError() {
  return {
    ok: false as const,
    message: "Check the highlighted details and try again.",
  };
}

function databaseMessage(code: string | undefined, fallback: string) {
  if (code === "23505") {
    return "That code, email, or employee number is already in use.";
  }

  if (code === "42501") {
    return "You do not have permission to make this change.";
  }

  return fallback;
}

export async function createStoreAction(
  input: unknown,
): Promise<ManagementActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "stores.manage")) {
    return { ok: false, message: "You do not have permission to create stores." };
  }

  const parsed = createStoreSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();

  if (!context.features.multi_store) {
    const { data: existingStores, error: existingStoresError } = await supabase
      .from("stores")
      .select("id")
      .eq("organization_id", context.organization.id)
      .limit(1);

    if (existingStoresError) {
      return { ok: false, message: "TINDIO could not verify the current store setup." };
    }

    if ((existingStores ?? []).length > 0) {
      return {
        ok: false,
        message: "Multi-store is disabled for this business. Enable it in Business Profile before adding another store.",
      };
    }
  }

  const { error } = await supabase.from("stores").insert({
    organization_id: context.organization.id,
    name: parsed.data.name,
    code: parsed.data.code,
    address: parsed.data.address || null,
    phone: parsed.data.phone || null,
  });

  if (error) {
    return {
      ok: false,
      message: databaseMessage(error.code, "TINDIO could not create the store."),
    };
  }

  revalidatePath("/back-office/stores");
  revalidatePath("/back-office");
  return { ok: true, message: "Store created." };
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

  const parsed = createRegisterSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { error } = await supabase.from("registers").insert({
    organization_id: context.organization.id,
    store_id: parsed.data.storeId,
    name: parsed.data.name,
    code: parsed.data.code,
  });

  if (error) {
    return {
      ok: false,
      message: databaseMessage(error.code, "TINDIO could not create the register."),
    };
  }

  revalidatePath("/back-office/registers");
  revalidatePath("/back-office");
  return { ok: true, message: "Register created." };
}

export async function createRoleAction(
  input: unknown,
): Promise<ManagementActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "roles.manage")) {
    return { ok: false, message: "You do not have permission to create roles." };
  }

  const parsed = createRoleSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_custom_role", {
    target_organization_id: context.organization.id,
    role_name: parsed.data.name,
    role_code: parsed.data.code,
    role_description: parsed.data.description,
    permission_codes: parsed.data.permissionCodes,
  });

  if (error) {
    return {
      ok: false,
      message: databaseMessage(error.code, "TINDIO could not create the role."),
    };
  }

  revalidatePath("/back-office/roles");
  revalidatePath("/back-office/employees");
  revalidatePath("/back-office");
  return { ok: true, message: "Custom role created." };
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

  const parsed = createInvitationSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const [roleResult, rolePermissionsResult, storeResult, employeeNumberResult] =
    await Promise.all([
      supabase
        .from("roles")
        .select("id, name")
        .eq("id", parsed.data.roleId)
        .eq("organization_id", context.organization.id)
        .maybeSingle(),
      supabase
        .from("role_permissions")
        .select("permission_code")
        .eq("organization_id", context.organization.id)
        .eq("role_id", parsed.data.roleId),
      supabase
        .from("stores")
        .select("id, name")
        .eq("id", parsed.data.storeId)
        .eq("organization_id", context.organization.id)
        .eq("is_active", true)
        .maybeSingle(),
      supabase
        .from("employees")
        .select("id")
        .eq("organization_id", context.organization.id)
        .eq("employee_number", parsed.data.employeeNumber)
        .maybeSingle(),
    ]);

  const lookupError = [
    roleResult,
    rolePermissionsResult,
    storeResult,
    employeeNumberResult,
  ].find((result) => result.error)?.error;

  if (lookupError) {
    return { ok: false, message: "TINDIO could not validate the invitation." };
  }

  if (!roleResult.data || !storeResult.data) {
    return { ok: false, message: "Select an active store and valid role." };
  }

  if (employeeNumberResult.data) {
    return { ok: false, message: "That employee number is already in use." };
  }

  const requestedPermissions = (rolePermissionsResult.data ?? []).map(
    (permission) => permission.permission_code,
  );
  if (requestedPermissions.some((permission) => !context.permissions.includes(permission))) {
    return {
      ok: false,
      message: "You cannot grant a role containing permissions you do not hold.",
    };
  }

  const token = createInvitationToken();
  const tokenHash = hashInvitationToken(token);
  const { error } = await supabase.from("employee_invitations").insert({
    organization_id: context.organization.id,
    organization_name_snapshot: context.organization.name,
    email: parsed.data.email,
    employee_number: parsed.data.employeeNumber,
    job_title: parsed.data.jobTitle || null,
    role_id: parsed.data.roleId,
    role_name_snapshot: roleResult.data.name,
    store_id: parsed.data.storeId,
    store_name_snapshot: storeResult.data.name,
    token_hash: tokenHash,
    invited_by: context.employee.id,
  });

  if (error) {
    return {
      ok: false,
      message: databaseMessage(error.code, "TINDIO could not create the invitation."),
    };
  }

  const { NEXT_PUBLIC_APP_URL } = getPublicEnvironment();
  const inviteQuery = new URLSearchParams({
    token,
    email: parsed.data.email,
  });
  const inviteUrl = `${NEXT_PUBLIC_APP_URL}/join?${inviteQuery.toString()}`;
  revalidatePath("/back-office/employees");

  return {
    ok: true,
    message: "Invitation created. Copy this link now; TINDIO stores only its hash.",
    data: { inviteUrl },
  };
}

export async function revokeEmployeeInvitationAction(
  input: unknown,
): Promise<ManagementActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "employees.manage")) {
    return { ok: false, message: "You do not have permission to revoke invitations." };
  }

  const parsed = revokeInvitationSchema.safeParse(input);
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", parsed.data.invitationId)
    .eq("organization_id", context.organization.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, message: "The invitation could not be revoked." };
  }

  revalidatePath("/back-office/employees");
  return { ok: true, message: "Invitation revoked." };
}

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
