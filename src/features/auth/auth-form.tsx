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
import { cn } from "@/lib/utils";

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
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const hasPasswordConfirmation = confirmPassword.length > 0;
  const passwordsMatch = hasPasswordConfirmation && password === confirmPassword;
  const confirmationError = hasPasswordConfirmation && !passwordsMatch
    ? "Passwords do not match."
    : passwordsMatch
      ? undefined
      : state?.fieldErrors?.confirmPassword?.[0];

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
          onChange={(event) => setPassword(event.target.value)}
          value={password}
        />
      </Field>
      <Field
        error={confirmationError}
        id="confirmPassword"
        label="Confirm password"
        success={passwordsMatch ? "Passwords match." : undefined}
      >
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          autoComplete="new-password"
          error={Boolean(confirmationError)}
          isValid={passwordsMatch}
          onChange={(event) => setConfirmPassword(event.target.value)}
          value={confirmPassword}
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
  isValid = false,
  name,
  onChange,
  value,
}: {
  autoComplete: React.ComponentProps<"input">["autoComplete"];
  error: boolean;
  id: string;
  isValid?: boolean;
  name: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  value?: string;
}) {
  const [isVisible, setIsVisible] = useState(false);

  const fieldLabel = name === "confirmPassword" ? "confirm password" : "password";

  return (
    <div className="relative">
      <input
        autoComplete={autoComplete}
        className={cn(
          "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 pr-10 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
          isValid && "border-emerald-600 focus-visible:border-emerald-600 focus-visible:ring-emerald-600/20",
        )}
        id={id}
        name={name}
        onChange={onChange}
        required
        type={isVisible ? "text" : "password"}
        value={value}
        aria-invalid={error}
      />
      <button
        aria-label={`${isVisible ? "Hide" : "Show"} ${fieldLabel}`}
        aria-pressed={isVisible}
        className="absolute inset-y-0 right-0 z-10 grid w-10 place-items-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={() => setIsVisible((current) => !current)}
        type="button"
      >
        {isVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </button>
    </div>
  );
}

function Field({
  children,
  error,
  hint,
  id,
  label,
  success,
}: {
  children: React.ReactNode;
  error?: string;
  hint?: string;
  id: string;
  label: string;
  success?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p aria-live="polite" className="text-sm text-destructive">{error}</p>
      ) : success ? (
        <p aria-live="polite" className="text-sm text-emerald-600 dark:text-emerald-400">
          {success}
        </p>
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
