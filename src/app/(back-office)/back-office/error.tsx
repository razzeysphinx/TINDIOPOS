"use client";

import { useEffect } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Keeps unexpected rendering failures actionable without exposing server details. */
export default function BackOfficeError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // Keep diagnostics available to developers without showing them to staff.
    console.error("Back Office rendering error", { digest: error.digest, error });
  }, [error]);

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <TriangleAlert aria-hidden="true" className="size-8 text-destructive" />
        <CardTitle className="mt-3">We couldn&apos;t open this page</CardTitle>
        <CardDescription>
          Your information was not changed. Check your connection, then try again. If the problem continues, ask an authorized manager for help.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={retry} type="button">
          <RefreshCw aria-hidden="true" />
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}
