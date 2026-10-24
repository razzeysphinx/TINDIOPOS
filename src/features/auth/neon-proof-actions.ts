"use server";

import { redirect } from "next/navigation";

import { signInSchema, signUpSchema } from "@/features/auth/auth-schema";
import {
  createNeonWebProofAuth,
  isSyntheticNeonProofEmail,
} from "@/lib/auth/neon-web-proof";

function proofRedirect(parameters: Record<string, string>): never {
  redirect(`/auth-proof?${new URLSearchParams(parameters)}`);
}

export async function neonProofSignUpAction(formData: FormData) {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    proofRedirect({ error: "Check the synthetic account details and try again." });
  }

  if (!isSyntheticNeonProofEmail(parsed.data.email)) {
    proofRedirect({ error: "Only the reserved synthetic proof domain is allowed." });
  }

  const auth = createNeonWebProofAuth();
  const { error } = await auth.signUp.email({
    email: parsed.data.email,
    name: parsed.data.fullName,
    password: parsed.data.password,
  });

  if (error) {
    proofRedirect({ error: "The isolated Neon account could not be created." });
  }

  proofRedirect({ event: "signed-up" });
}

export async function neonProofSignInAction(formData: FormData) {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success || !isSyntheticNeonProofEmail(parsed.data.email)) {
    proofRedirect({ error: "Email or password is incorrect." });
  }

  const auth = createNeonWebProofAuth();
  const { error } = await auth.signIn.email(parsed.data);

  if (error) {
    proofRedirect({ error: "Email or password is incorrect." });
  }

  proofRedirect({ event: "signed-in" });
}

export async function neonProofSignOutAction() {
  const auth = createNeonWebProofAuth();
  const { data: current } = await auth.getSession();
  const sessionToken = current?.session?.token;

  if (sessionToken) {
    const { error: revocationError } = await auth.revokeSession({
      token: sessionToken,
    });

    if (revocationError) {
      proofRedirect({ error: "The synthetic session could not be revoked." });
    }
  }

  const { error } = await auth.signOut();
  if (error) {
    proofRedirect({ error: "The synthetic session could not be signed out." });
  }
  proofRedirect({ event: "signed-out" });
}
