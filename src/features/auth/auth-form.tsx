"use client";

import { useActionState, useState } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";

import {
  signInFormAction,
  signUpFormAction,
} from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AuthForm({
  defaultEmail,
  lockEmail = false,
  mode,
  nextPath,
}: {
  defaultEmail?: string;
  lockEmail?: boolean;
  mode: "login" | "signup";
  nextPath?: string;
}) {
  return mode === "login" ? (
    <SignInForm
      defaultEmail={defaultEmail}
      lockEmail={lockEmail}
      nextPath={nextPath}
    />
  ) : (
    <SignUpForm
      defaultEmail={defaultEmail}
      lockEmail={lockEmail}
      nextPath={nextPath}
    />
  );
}

function SignInForm({
  defaultEmail = "",
  lockEmail,
  nextPath,
}: {
  defaultEmail?: string;
  lockEmail: boolean;
  nextPath?: string;
}) {
  const [state, formAction, isPending] = useActionState(
    signInFormAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-5">
      <input name="next" type="hidden" value={nextPath ?? "/back-office"} />
      <Field
        error={state?.fieldErrors?.email?.[0]}
        hint={
          lockEmail
            ? "This is the email your manager invited. If it is wrong, ask them to revoke this invitation and create a new one."
            : undefined
        }
        id="email"
        label="Email"
      >
        <Input
          defaultValue={defaultEmail}
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@business.com"
          readOnly={lockEmail}
          required
          aria-invalid={Boolean(state?.fieldErrors?.email)}
        />
      </Field>
      <Field
        error={state?.fieldErrors?.password?.[0]}
        id="password"
        label="Password"
      >
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          error={Boolean(state?.fieldErrors?.password)}
        />
      </Field>
      <SubmitButton isPending={isPending}>Sign in</SubmitButton>
      {state ? (
        <p
          className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
          role="alert"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function SignUpForm({
  defaultEmail = "",
  lockEmail,
  nextPath,
}: {
  defaultEmail?: string;
  lockEmail: boolean;
  nextPath?: string;
}) {
  const [state, formAction, isPending] = useActionState(
    signUpFormAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-5">
      <input name="next" type="hidden" value={nextPath ?? "/onboarding"} />
      <Field
        error={state?.fieldErrors?.fullName?.[0]}
        id="fullName"
        label="Full name"
      >
        <Input
          id="fullName"
          name="fullName"
          autoComplete="name"
          placeholder="Maria Santos"
          required
          aria-invalid={Boolean(state?.fieldErrors?.fullName)}
        />
      </Field>
      <Field
        error={state?.fieldErrors?.email?.[0]}
        hint={
          lockEmail
            ? "This is the email your manager invited. If it is wrong, ask them to revoke this invitation and create a new one."
            : undefined
        }
        id="email"
        label="Email"
      >
        <Input
          defaultValue={defaultEmail}
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@business.com"
          readOnly={lockEmail}
          required
          aria-invalid={Boolean(state?.fieldErrors?.email)}
        />
      </Field>
      <Field
        error={state?.fieldErrors?.password?.[0]}
        id="password"
        label="Password"
        hint="12+ characters with upper, lower, number, and symbol."
      >
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          error={Boolean(state?.fieldErrors?.password)}
        />
      </Field>
      <Field
        error={state?.fieldErrors?.confirmPassword?.[0]}
        id="confirmPassword"
        label="Confirm password"
      >
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          autoComplete="new-password"
          error={Boolean(state?.fieldErrors?.confirmPassword)}
        />
      </Field>
      <SubmitButton isPending={isPending}>Create account</SubmitButton>
      {state ? (
        <p
          className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
          role="alert"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function PasswordInput({
  autoComplete,
  error,
  id,
  name,
}: {
  autoComplete: React.ComponentProps<"input">["autoComplete"];
  error: boolean;
  id: string;
  name: string;
}) {
  const [isVisible, setIsVisible] = useState(false);

  const fieldLabel = name === "confirmPassword" ? "confirm password" : "password";

  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={isVisible ? "text" : "password"}
        autoComplete={autoComplete}
        className="pr-10"
        required
        aria-invalid={error}
      />
      <Button
        aria-label={`${isVisible ? "Hide" : "Show"} ${fieldLabel}`}
        aria-pressed={isVisible}
        className="absolute inset-y-0 right-0 text-muted-foreground hover:text-foreground"
        onClick={() => setIsVisible((current) => !current)}
        size="icon"
        type="button"
        variant="ghost"
      >
        {isVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </div>
  );
}

function Field({
  children,
  error,
  hint,
  id,
  label,
}: {
  children: React.ReactNode;
  error?: string;
  hint?: string;
  id: string;
  label: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs leading-5 text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function SubmitButton({
  children,
  isPending,
}: {
  children: React.ReactNode;
  isPending: boolean;
}) {
  return (
    <Button className="h-11 w-full" disabled={isPending} type="submit">
      {isPending ? (
        <LoaderCircle className="animate-spin" aria-hidden="true" />
      ) : (
        <ArrowRight aria-hidden="true" />
      )}
      {isPending ? "Please wait…" : children}
    </Button>
  );
}
