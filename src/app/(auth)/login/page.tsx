import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { TindioMark } from "@/components/brand/tindio-mark";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthForm } from "@/features/auth/auth-form";
import { getVerifiedUser } from "@/lib/auth/dal";
import { getSafeRedirectPath } from "@/lib/auth/safe-redirect";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ confirmed?: string; email?: string; next?: string }>;
}) {
  await connection();
  const { confirmed, email, next } = await searchParams;
  const nextPath = getSafeRedirectPath(next, "/workspace");
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
          <p className="text-sm font-semibold text-primary">Welcome back</p>
          <CardTitle className="text-3xl tracking-[-0.035em]">
            {isInvitationFlow ? "Sign in to join your business" : "Sign in to TINDIO"}
          </CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            {isInvitationFlow
              ? "Use the exact email address that received the employee invitation."
              : "Access your business setup and Back Office."}
          </p>
        </CardHeader>
        <CardContent>
          <AuthForm
            defaultEmail={defaultEmail}
            lockEmail={isInvitationFlow && Boolean(defaultEmail)}
            mode="login"
            nextPath={nextPath}
          />
          {confirmed === "pending" ? (
            <p
              aria-live="polite"
              className="mt-5 rounded-lg border border-primary/25 bg-secondary px-3 py-2.5 text-sm leading-6 text-secondary-foreground"
              role="status"
            >
              <span className="font-semibold text-primary">
                Success — your account was created.
              </span>{" "}
              Check your email for the confirmation link, then return here to sign in.
            </p>
          ) : null}
          <p className="mt-6 text-center text-sm text-muted-foreground">
            New to TINDIO?{" "}
            <Link
              className="font-semibold text-primary hover:underline"
              href={`/signup?next=${encodeURIComponent(nextPath)}`}
            >
              Create an account
            </Link>
          </p>
        </CardContent>
      </Card>
    </>
  );
}
