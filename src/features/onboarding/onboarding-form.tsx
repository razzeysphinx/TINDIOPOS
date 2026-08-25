"use client";

import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createBusinessAction } from "@/features/onboarding/actions";
import type { OnboardingActionResult } from "@/features/onboarding/onboarding-types";
import {
  onboardingSchema,
  type OnboardingValues,
} from "@/features/onboarding/onboarding-schema";
import { businessTypeLabels, businessTypes } from "@/features/business-profile/business-features";

const fields: Array<{
  name: keyof OnboardingValues;
  label: string;
  placeholder: string;
  hint: string;
}> = [
  {
    name: "organizationName",
    label: "Business name",
    placeholder: "Northstar Retail",
    hint: "Shown across your Back Office and future receipts.",
  },
  {
    name: "storeName",
    label: "First store",
    placeholder: "Main Store",
    hint: "You can add more locations later.",
  },
  {
    name: "registerName",
    label: "First register",
    placeholder: "Front Counter",
    hint: "The physical or virtual checkout station.",
  },
];

export function OnboardingForm() {
  const router = useRouter();
  const [result, setResult] = useState<OnboardingActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      organizationName: "",
      businessType: "retail",
      storeName: "Main Store",
      registerName: "Register 1",
    },
  });

  const submit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await createBusinessAction(values);
      setResult(nextResult);

      if (nextResult.ok) {
        router.replace(nextResult.redirectTo);
        router.refresh();
      }
    });
  });

  return (
    <form className="space-y-5" onSubmit={submit} noValidate>
      {fields.map((field) => {
        const error = form.formState.errors[field.name]?.message;

        return (
          <div className="space-y-2" key={field.name}>
            <Label htmlFor={field.name}>{field.label}</Label>
            <Input
              id={field.name}
              aria-invalid={Boolean(error)}
              placeholder={field.placeholder}
              {...form.register(field.name)}
            />
            <p
              className={
                error
                  ? "text-sm text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {error ?? field.hint}
            </p>
          </div>
        );
      })}

      <div className="space-y-2">
        <Label htmlFor="businessType">Business type</Label>
        <select
          className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          id="businessType"
          {...form.register("businessType")}
        >
          {businessTypes.map((businessType) => (
            <option key={businessType} value={businessType}>
              {businessTypeLabels[businessType]}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          TINDIO uses this to recommend features. You can change it later.
        </p>
      </div>

      <Button className="h-11 w-full" disabled={isPending} type="submit">
        {isPending ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        ) : (
          <ArrowRight aria-hidden="true" />
        )}
        {isPending ? "Creating your business…" : "Create business"}
      </Button>

      {result && !result.ok ? (
        <p
          className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
          role="alert"
        >
          {result.message}
        </p>
      ) : null}
    </form>
  );
}
