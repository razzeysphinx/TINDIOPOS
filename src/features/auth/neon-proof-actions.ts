"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { signInSchema, signUpSchema } from "@/features/auth/auth-schema";
import {
  createNeonWebProofAuth,
  getNeonWebProofOrigin,
  isSyntheticNeonProofEmail,
} from "@/lib/auth/neon-web-proof";

const proofEmailSchema = z
  .string()
  .trim()
  .email()
  .max(320)
  .transform((value) => value.toLowerCase());

const verifyEmailSchema = z.object({
  email: proofEmailSchema,
  otp: z.string().trim().regex(/^\d{6}$/),
});

const requestPasswordResetSchema = z.object({ email: proofEmailSchema });

const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(1).max(256),
    password: z
      .string()
      .min(12)
      .max(128)
      .regex(/[a-z]/)
      .regex(/[A-Z]/)
      .regex(/[0-9]/)
      .regex(/[^A-Za-z0-9]/),
    confirmPassword: z.string().min(1).max(128),
  })
  .refine(({ password, confirmPassword }) => password === confirmPassword, {
    path: ["confirmPassword"],
  });

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
  const { data, error } = await auth.signUp.email({
    email: parsed.data.email,
    name: parsed.data.fullName,
    password: parsed.data.password,
  });

  if (error) {
    proofRedirect({ error: "The isolated Neon account could not be created." });
  }

  proofRedirect({
    event: data?.user?.emailVerified === false || !data?.token
      ? "verification-required"
      : "signed-up",
  });
}

export async function neonProofVerifyEmailAction(formData: FormData) {
  const parsed = verifyEmailSchema.safeParse({
    email: formData.get("email"),
    otp: formData.get("otp"),
  });

  if (!parsed.success || !isSyntheticNeonProofEmail(parsed.data.email)) {
    proofRedirect({ error: "The verification code could not be accepted." });
  }

  const auth = createNeonWebProofAuth();
  const { error } = await auth.emailOtp.verifyEmail(parsed.data);
  if (error) {
    proofRedirect({ error: "The verification code could not be accepted." });
  }

  proofRedirect({ event: "email-verified" });
}

export async function neonProofRequestEmailVerificationAction(formData: FormData) {
  const parsed = requestPasswordResetSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success || !isSyntheticNeonProofEmail(parsed.data.email)) {
    proofRedirect({ error: "The verification request could not be accepted." });
  }

  const auth = createNeonWebProofAuth();
  const { error } = await auth.emailOtp.sendVerificationOtp({
    email: parsed.data.email,
    type: "email-verification",
  });
  if (error) {
    proofRedirect({ error: "The verification request could not be accepted." });
  }

  proofRedirect({ event: "verification-requested" });
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

export async function neonProofRequestPasswordResetAction(formData: FormData) {
  const parsed = requestPasswordResetSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success || !isSyntheticNeonProofEmail(parsed.data.email)) {
    proofRedirect({ error: "The recovery request could not be accepted." });
  }

  const auth = createNeonWebProofAuth();
  const { error } = await auth.requestPasswordReset({
    email: parsed.data.email,
    redirectTo: `${getNeonWebProofOrigin()}/auth-proof`,
  });
  if (error) {
    proofRedirect({ error: "The recovery request could not be accepted." });
  }

  proofRedirect({ event: "recovery-requested" });
}

export async function neonProofResetPasswordAction(formData: FormData) {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    proofRedirect({ error: "The password reset could not be completed." });
  }

  const auth = createNeonWebProofAuth();
  const { error } = await auth.resetPassword({
    newPassword: parsed.data.password,
    token: parsed.data.token,
  });
  if (error) {
    proofRedirect({ error: "The password reset could not be completed." });
  }

  proofRedirect({ event: "password-reset" });
}
