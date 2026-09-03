"use client";

import { LoaderCircle, Sparkles } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  businessTypeLabels,
  businessTypes,
  featureDefinitions,
  recommendedFeatureSettings,
  type BusinessType,
  type OrganizationFeatureSettings,
} from "@/features/business-profile/business-features";
import { updateBusinessProfileAction } from "@/features/business-profile/actions";

export function BusinessProfileManager({
  initialBusinessType,
  initialFeatures,
  canManage,
}: {
  initialBusinessType: BusinessType;
  initialFeatures: OrganizationFeatureSettings;
  canManage: boolean;
}) {
  const [businessType, setBusinessType] = useState(initialBusinessType);
  const [features, setFeatures] = useState(initialFeatures);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const useRecommendations = () => {
    setFeatures(recommendedFeatureSettings(businessType));
    setMessage("Recommendations loaded. Review the feature switches, then save your changes.");
  };

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await updateBusinessProfileAction({ businessType, features });
      setMessage(result.message);
    });
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Business type</CardTitle>
          <CardDescription>
            This provides a sensible starting point. You can review and change optional tools whenever your business needs them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="grid gap-2 text-sm font-medium" htmlFor="business-type">
            What type of business are you?
            <select
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              disabled={!canManage || isPending}
              id="business-type"
              onChange={(event) => setBusinessType(event.target.value as BusinessType)}
              value={businessType}
            >
              {businessTypes.map((type) => <option key={type} value={type}>{businessTypeLabels[type]}</option>)}
            </select>
          </label>
          <Button disabled={!canManage || isPending} onClick={useRecommendations} type="button" variant="outline">
            <Sparkles />Use recommendations
          </Button>
          <p className="text-xs text-muted-foreground">
            Recommendations never remove historical records. Saving only changes what TINDIO exposes for future use.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Optional tools</CardTitle>
          <CardDescription>
            Turn on only the parts of TINDIO your business is ready to use. Existing records stay intact when a tool is turned off.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <details className="group" open={false}>
            <summary className="cursor-pointer list-none rounded-lg border px-3 py-3 text-sm font-medium marker:hidden hover:bg-muted/50">Review optional tools <span className="ml-1 font-normal text-muted-foreground">Advanced selling and operations</span></summary>
            <div className="mt-3 space-y-3">
          {featureDefinitions.map((feature) => (
            <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-3" key={feature.key}>
              <span>
                <span className="block text-sm font-medium">{feature.label}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{feature.description}</span>
              </span>
              <input
                aria-label={`Enable ${feature.label}`}
                checked={features[feature.key]}
                className="mt-1 size-4 accent-primary"
                disabled={!canManage || isPending}
                onChange={(event) => setFeatures((current) => ({
                  ...current,
                  [feature.key]: event.target.checked,
                }))}
                type="checkbox"
              />
            </label>
          ))}
          {canManage ? (
            <Button disabled={isPending} onClick={save} type="button">
              {isPending ? <LoaderCircle className="animate-spin" /> : null}
              Save business profile
            </Button>
          ) : (
            <p className="rounded-lg border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
              Ask an owner or authorized administrator to change this business profile.
            </p>
          )}
          {message ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
