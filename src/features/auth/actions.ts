"use server";

import { redirect } from "next/navigation";

import { signInSchema, signUpSchema } from "@/features/auth/auth-schema";
import { getSafeRedirectPath } from "@/lib/auth/safe-redirect";
import { getPublicEnvironment } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type AuthActionResult =
  | { ok: true; redirectTo: string; message?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

export type AuthFormState = {
  message: string;
  fieldErrors?: Record<string, string[]>;
} | null;

export async function signInAction(
  input: unknown,
  requestedNext?: unknown,
): Promise<AuthActionResult> {
  const parsed = signInSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the highlighted details and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { ok: false, message: "Email or password is incorrect." };
  }

  const next = getSafeRedirectPath(requestedNext, "/back-office");

  // Invitation links retain an explicit review step and their possession token.
  if (next.startsWith("/join?")) {
    return { ok: true, redirectTo: next };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("employees")
    .select("id")
    .eq("profile_id", data.user.id)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    await supabase.auth.signOut();
    return {
      ok: false,
      message: "TINDIO signed you in but could not verify your employee access. Please try again.",
    };
  }

  if (!membership && data.user.email) {
    const { data: invitations, error: invitationError } = await supabase
      .from("employee_invitations")
      .select("token_hash")
      .eq("email", data.user.email.trim().toLowerCase())
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(2);

    if (invitationError) {
      await supabase.auth.signOut();
      return {
        ok: false,
        message: "TINDIO signed you in but could not check your employee invitation. Please try again.",
      };
    }

    // A single verified-email invitation is unambiguous, so finish the role
    // assignment atomically before entering the Back Office.
    if (invitations.length === 1) {
      const { error: acceptanceError } = await supabase.rpc(
        "accept_employee_invitation",
        { invitation_token_hash: invitations[0].token_hash },
      );

      if (acceptanceError) {
        await supabase.auth.signOut();
        return {
          ok: false,
          message:
            "Your password was accepted, but TINDIO could not attach your employee role. Try again or ask your manager to recreate the invitation.",
        };
      }

      return { ok: true, redirectTo: "/back-office" };
    }

    if (invitations.length > 1) {
      return { ok: true, redirectTo: "/onboarding" };
    }
  }

  return {
    ok: true,
    redirectTo: next,
  };
}

export async function signInFormAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const result = await signInAction(
    {
      email: formData.get("email"),
      password: formData.get("password"),
    },
    formData.get("next"),
  );

  if (!result.ok) {
    return {
      message: result.message,
      fieldErrors: result.fieldErrors,
    };
  }

  redirect(result.redirectTo);
}

export async function signUpAction(
  input: unknown,
  requestedNext?: unknown,
): Promise<AuthActionResult> {
  const parsed = signUpSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the highlighted details and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { NEXT_PUBLIC_APP_URL } = getPublicEnvironment();
  const next = getSafeRedirectPath(requestedNext, "/onboarding");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  if (!data.user || data.user.identities?.length === 0) {
    return {
      ok: false,
      message:
        "TINDIO could not start account confirmation. If this email already has an account, sign in instead; otherwise use the exact email from the invitation and try again.",
    };
  }

  if (!data.session) {
    return {
      ok: true,
      redirectTo: `/login?confirmed=pending&email=${encodeURIComponent(parsed.data.email)}&next=${encodeURIComponent(next)}`,
      message: "Check your email to confirm your TINDIO account.",
    };
  }

  return { ok: true, redirectTo: next };
}

export async function signUpFormAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const result = await signUpAction(
    {
      fullName: formData.get("fullName"),
      email: formData.get("email"),
      password: formData.get("password"),
    },
    formData.get("next"),
  );

  if (!result.ok) {
    return {
      message: result.message,
      fieldErrors: result.fieldErrors,
    };
  }

  redirect(result.redirectTo);
}

export async function signOutAction(formData?: FormData) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(getSafeRedirectPath(formData?.get("next"), "/login"));
}
