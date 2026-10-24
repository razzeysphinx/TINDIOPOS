"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FlaskConical, LoaderCircle, LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  neonProofRequestPasswordResetAction,
  neonProofRequestEmailVerificationAction,
  neonProofResetPasswordAction,
  neonProofSignInAction,
  neonProofSignOutAction,
  neonProofSignUpAction,
  neonProofVerifyEmailAction,
} from "@/features/auth/neon-proof-actions";

type ProofEvent =
  | "email-verified"
  | "password-reset"
  | "recovery-requested"
  | "signed-in"
  | "signed-out"
  | "signed-up"
  | "verification-required"
  | "verification-requested";

type ProofUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
};

const eventMessages: Record<ProofEvent, string> = {
  "email-verified": "Synthetic email verified and session established.",
  "password-reset": "Synthetic password reset completed.",
  "recovery-requested": "Synthetic recovery request accepted.",
  "signed-in": "Synthetic password sign-in succeeded.",
  "signed-out": "Synthetic session signed out.",
  "signed-up": "Synthetic account created and session established.",
  "verification-required": "Synthetic account created. Enter its branch-local verification code.",
  "verification-requested": "Branch-local email verification code requested.",
};

export function NeonAuthProofSurface({
  error,
  event,
}: {
  error?: string;
  event?: ProofEvent;
}) {
  const [session, setSession] = useState<
    | { state: "loading" }
    | { state: "ready"; user: ProofUser | null }
    | { state: "error" }
  >({ state: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    void fetch("/api/auth-proof/session", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Session check failed");
        return response.json() as Promise<{ user: ProofUser | null }>;
      })
      .then(({ user }) => setSession({ state: "ready", user }))
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setSession({ state: "error" });
      });

    return () => controller.abort();
  }, [event]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 py-8">
      <div className="rounded-2xl border border-amber-300/70 bg-amber-50 px-5 py-4 text-amber-950">
        <div className="flex items-start gap-3">
          <FlaskConical className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Local synthetic proof only</p>
            <p className="mt-1 text-sm leading-6">
              This screen is unavailable unless the explicit local Neon proof guard passes.
              It accepts only addresses ending in @auth-proof.tindio.invalid.
            </p>
          </div>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {event ? (
        <p className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-950" role="status">
          {eventMessages[event]}
        </p>
      ) : null}

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-primary">Phase E6</p>
            <CardTitle className="text-3xl tracking-[-0.035em]">
              Isolated Neon Web Auth lifecycle
            </CardTitle>
            <p className="text-sm leading-6 text-muted-foreground">
              Supabase remains TINDIO&apos;s default. This surface exercises verification,
              session refresh, and recovery only on the temporary Neon branch.
            </p>
          </div>
          <div className="rounded-xl bg-secondary p-3 text-primary">
            <LockKeyhole aria-hidden="true" />
          </div>
        </CardHeader>
        <CardContent>
          {session.state === "loading" ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground" role="status">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              Checking the isolated session…
            </div>
          ) : session.state === "error" ? (
            <p className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
              The isolated session could not be checked.
            </p>
          ) : session.user ? (
            <div className="space-y-5">
              <div className="flex items-start gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-semibold" data-testid="proof-session-status">Session active</p>
                  <p className="mt-1 text-sm" data-testid="proof-session-email">{session.user.email}</p>
                  <p className="mt-1 text-sm" data-testid="proof-email-verification-status">
                    Email {session.user.emailVerified ? "verified" : "not verified"}
                  </p>
                </div>
              </div>
              <form action={neonProofSignOutAction}>
                <Button type="submit" variant="outline">Sign out proof session</Button>
              </form>
              {!session.user.emailVerified ? (
                <div className="grid gap-6 lg:grid-cols-2">
                  <RequestEmailVerificationForm />
                  <VerifyEmailForm />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <CredentialForm action={neonProofSignUpAction} mode="signup" />
              <CredentialForm action={neonProofSignInAction} mode="signin" />
              <RequestEmailVerificationForm />
              <VerifyEmailForm />
              <RequestRecoveryForm />
              <ResetPasswordForm />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RequestEmailVerificationForm() {
  return (
    <form action={neonProofRequestEmailVerificationAction} className="space-y-4 rounded-xl border p-5">
      <FormIntroduction title="Request email verification" description="Creates a six-digit challenge in the branch-local auth store." />
      <ProofField id="proof-verification-request-email" label="Verification request email">
        <Input id="proof-verification-request-email" name="email" type="email" autoComplete="email" required />
      </ProofField>
      <Button type="submit">Request verification code</Button>
    </form>
  );
}

function CredentialForm({
  action,
  mode,
}: {
  action: (formData: FormData) => Promise<void>;
  mode: "signin" | "signup";
}) {
  const isSignUp = mode === "signup";

  return (
    <form action={action} className="space-y-4 rounded-xl border p-5">
      <FormIntroduction
        title={isSignUp ? "Create synthetic account" : "Sign in synthetic account"}
        description={isSignUp ? "Creates data only inside the disposable proof branch." : "Exercises password acceptance and denial."}
      />
      {isSignUp ? (
        <ProofField id="proof-full-name" label="Synthetic name">
          <Input id="proof-full-name" name="fullName" autoComplete="name" required />
        </ProofField>
      ) : null}
      <ProofField id={`proof-${mode}-email`} label="Synthetic email">
        <Input id={`proof-${mode}-email`} name="email" type="email" autoComplete="email" required />
      </ProofField>
      <ProofField id={`proof-${mode}-password`} label="Password">
        <Input id={`proof-${mode}-password`} name="password" type="password" autoComplete={isSignUp ? "new-password" : "current-password"} required />
      </ProofField>
      {isSignUp ? (
        <ProofField id="proof-confirm-password" label="Confirm password">
          <Input id="proof-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required />
        </ProofField>
      ) : null}
      <Button type="submit">{isSignUp ? "Create proof account" : "Sign in for proof"}</Button>
    </form>
  );
}

function VerifyEmailForm() {
  return (
    <form action={neonProofVerifyEmailAction} className="space-y-4 rounded-xl border p-5">
      <FormIntroduction title="Verify synthetic email" description="Accepts the six-digit code created in the branch-local auth store." />
      <ProofField id="proof-verification-email" label="Verification email">
        <Input id="proof-verification-email" name="email" type="email" autoComplete="email" required />
      </ProofField>
      <ProofField id="proof-verification-code" label="Verification code">
        <Input id="proof-verification-code" name="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required />
      </ProofField>
      <Button type="submit">Verify proof email</Button>
    </form>
  );
}

function RequestRecoveryForm() {
  return (
    <form action={neonProofRequestPasswordResetAction} className="space-y-4 rounded-xl border p-5">
      <FormIntroduction title="Request password recovery" description="Creates a branch-local recovery challenge with a localhost return URL." />
      <ProofField id="proof-recovery-email" label="Recovery email">
        <Input id="proof-recovery-email" name="email" type="email" autoComplete="email" required />
      </ProofField>
      <Button type="submit">Request proof recovery</Button>
    </form>
  );
}

function ResetPasswordForm() {
  return (
    <form action={neonProofResetPasswordAction} className="space-y-4 rounded-xl border p-5 lg:col-span-2">
      <FormIntroduction title="Complete password recovery" description="Consumes the single-use branch-local recovery token without exposing it to application logs." />
      <div className="grid gap-4 lg:grid-cols-3">
        <ProofField id="proof-recovery-token" label="Recovery token">
          <Input id="proof-recovery-token" name="token" autoComplete="off" required />
        </ProofField>
        <ProofField id="proof-new-password" label="New password">
          <Input id="proof-new-password" name="password" type="password" autoComplete="new-password" required />
        </ProofField>
        <ProofField id="proof-new-password-confirmation" label="Confirm new password">
          <Input id="proof-new-password-confirmation" name="confirmPassword" type="password" autoComplete="new-password" required />
        </ProofField>
      </div>
      <Button type="submit">Reset proof password</Button>
    </form>
  );
}

function FormIntroduction({ description, title }: { description: string; title: string }) {
  return (
    <div>
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function ProofField({
  children,
  id,
  label,
}: {
  children: React.ReactNode;
  id: string;
  label: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
