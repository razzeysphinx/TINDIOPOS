import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { TindioMark } from "@/components/brand/tindio-mark";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthForm } from "@/features/auth/auth-form";
import { getVerifiedUser } from "@/lib/auth/dal";
import { getSafeRedirectPath } from "@/lib/auth/safe-redirect";

export const metadata = { title: "Create account" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; next?: string }>;
}) {
  await connection();
  const { email, next } = await searchParams;
  const nextPath = getSafeRedirectPath(next, "/onboarding");
  const user = await getVerifiedUser();

  if (user) {
    redirect(nextPath);
  }

  const isInvitationFlow = nextPath.startsWith("/join?");
  const defaultEmail = typeof email === "string" && email.length <= 254 ? email : "";

  return (
    <>
      <Link className="mb-8 inline-flex lg:hidden" href="/">
        <TindioMark />
      </Link>
      <Card className="border-border/80 shadow-sm">
        <CardHeader className="space-y-2">
          <p className="text-sm font-semibold text-primary">Start securely</p>
          <CardTitle className="text-3xl tracking-[-0.035em]">
            {isInvitationFlow ? "Create your employee account" : "Create your account"}
          </CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            {isInvitationFlow
              ? "Confirm that the locked email below matches the invitation. If it is wrong, ask your manager to revoke the invitation and create a new one."
              : "Your first account becomes the business owner during setup."}
          </p>
        </CardHeader>
        <CardContent>
          <AuthForm
            defaultEmail={defaultEmail}
            lockEmail={isInvitationFlow && Boolean(defaultEmail)}
            mode="signup"
            nextPath={nextPath}
          />
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              className="font-semibold text-primary hover:underline"
              href={`/login?next=${encodeURIComponent(nextPath)}`}
            >
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </>
  );
}
