"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FlaskConical, LoaderCircle, LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  neonProofSignInAction,
  neonProofSignOutAction,
  neonProofSignUpAction,
} from "@/features/auth/neon-proof-actions";

type ProofUser = {
  id: string;
  email: string;
  name: string;
};

export function NeonAuthProofSurface({
  error,
  event,
}: {
  error?: string;
  event?: "signed-in" | "signed-out" | "signed-up";
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
    <div className="mx-auto w-full max-w-5xl space-y-5 py-8">
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
          {event === "signed-up"
            ? "Synthetic account created and session established."
            : event === "signed-in"
              ? "Synthetic password sign-in succeeded."
              : "Synthetic session signed out."}
        </p>
      ) : null}

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-primary">Phase E4</p>
            <CardTitle className="text-3xl tracking-[-0.035em]">
              Isolated Neon Web Auth proof
            </CardTitle>
            <p className="text-sm leading-6 text-muted-foreground">
              Supabase remains TINDIO&apos;s default. This surface exists only to exercise the temporary Neon branch.
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
                </div>
              </div>
              <form action={neonProofSignOutAction}>
                <Button type="submit" variant="outline">Sign out proof session</Button>
              </form>
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <ProofForm action={neonProofSignUpAction} mode="signup" />
              <ProofForm action={neonProofSignInAction} mode="signin" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProofForm({
  action,
  mode,
}: {
  action: (formData: FormData) => Promise<void>;
  mode: "signin" | "signup";
}) {
  const isSignUp = mode === "signup";

  return (
    <form action={action} className="space-y-4 rounded-xl border p-5">
      <div>
        <h2 className="font-semibold">{isSignUp ? "Create synthetic account" : "Sign in synthetic account"}</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {isSignUp ? "Creates data only inside the disposable proof branch." : "Exercises password acceptance and denial."}
        </p>
      </div>
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
