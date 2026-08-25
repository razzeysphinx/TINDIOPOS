import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Authentication issue" };

export default function AuthErrorPage() {
  return (
    <main className="grid min-h-svh place-items-center bg-muted/45 px-5">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader>
          <CardTitle>We could not complete sign-in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm leading-6 text-muted-foreground">
            The confirmation link may have expired or already been used. Return
            to sign in and try again.
          </p>
          <Link className={buttonVariants({ className: "w-full" })} href="/login">
            Return to sign in
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
