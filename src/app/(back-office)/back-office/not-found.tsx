import { SearchX } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** A route-safe explanation that does not disclose whether a protected record exists. */
export default function BackOfficeNotFound() {
  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <SearchX aria-hidden="true" className="size-8 text-muted-foreground" />
        <CardTitle className="mt-3">This page is not available</CardTitle>
        <CardDescription>
          It may have moved, the selected store may no longer be available, or your current access does not include it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button nativeButton={false} render={<Link href="/back-office" />}>
          Return to Back Office
        </Button>
      </CardContent>
    </Card>
  );
}
