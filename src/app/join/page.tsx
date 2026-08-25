import { Building2, CalendarClock, IdCard, ShieldCheck, Store } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";

import { TindioMark } from "@/components/brand/tindio-mark";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { signOutAction } from "@/features/auth/actions";
import { AcceptInvitationButton } from "@/features/management/management-forms";
import { hashInvitationToken } from "@/features/management/invitation-token";
import { invitationTokenSchema } from "@/features/management/management-schema";
import { getBusinessContext, getVerifiedUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Join business" };

export default async function JoinBusinessPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; token?: string }>;
}) {
  await connection();
  const { email, token } = await searchParams;
  const parsedToken = invitationTokenSchema.safeParse(token);

  if (!parsedToken.success) {
    return <InvitationUnavailable />;
  }

  const recipientEmail = getRecipientEmail(email);
  const invitationQuery = new URLSearchParams({ token: parsedToken.data });
  if (recipientEmail) invitationQuery.set("email", recipientEmail);

  const nextPath = `/join?${invitationQuery.toString()}`;
  const authEmail = recipientEmail ? `&email=${encodeURIComponent(recipientEmail)}` : "";
  const signInPath = `/login?next=${encodeURIComponent(nextPath)}${authEmail}`;
  const signUpPath = `/signup?next=${encodeURIComponent(nextPath)}${authEmail}`;
  const user = await getVerifiedUser();

  if (!user) {
    return (
      <InvitationFrame>
        <CardHeader>
          <p className="text-sm font-semibold text-primary">Employee invitation</p>
          <CardTitle className="text-2xl tracking-[-0.03em]">
            Sign in to review your invitation
          </CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            Use the exact email address that received this TINDIO invitation.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Link
            className={buttonVariants({ className: "w-full" })}
            href={signInPath}
          >
            Sign in
          </Link>
          <Link
            className={buttonVariants({ className: "w-full", variant: "outline" })}
            href={signUpPath}
          >
            Create account
          </Link>
        </CardContent>
      </InvitationFrame>
    );
  }

  if (await getBusinessContext()) {
    return (
      <InvitationUnavailable
        title="This account is already assigned"
        message={
          <>
            You are signed in as <strong>{user.email ?? "this account"}</strong>. An
            employee invitation can only be accepted by an account that does not
            already belong to a TINDIO organization.
          </>
        }
        actions={<InvitationSignOutAction signInPath={signInPath} />}
      />
    );
  }

  const supabase = await createClient();
  const { data: invitation, error } = await supabase
    .from("employee_invitations")
    .select(
      "email, employee_number, job_title, organization_name_snapshot, role_name_snapshot, store_name_snapshot, expires_at",
    )
    .eq("token_hash", hashInvitationToken(parsedToken.data))
    .maybeSingle();

  if (error || !invitation) {
    return (
      <InvitationUnavailable
        title="Invitation does not match this account"
        message={
          <>
            This link is invalid, expired, or was created for a different email
            address. You are signed in as <strong>{user.email ?? "this account"}</strong>.
            Sign out, then create or sign in with the exact email entered when this
            invitation was created.
          </>
        }
        actions={<InvitationSignOutAction signInPath={signInPath} />}
      />
    );
  }

  return (
    <InvitationFrame>
      <CardHeader>
        <p className="text-sm font-semibold text-primary">You’re invited</p>
        <CardTitle className="text-2xl tracking-[-0.03em]">
          Join {invitation.organization_name_snapshot}
        </CardTitle>
        <p className="text-sm leading-6 text-muted-foreground">
          Confirm the assignment below. Acceptance creates one employee record,
          role assignment, and store assignment together.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid gap-3 rounded-lg border border-border bg-muted/35 p-4 sm:grid-cols-2">
          <InvitationDetail icon={IdCard} label="Employee number">
            {invitation.employee_number}
          </InvitationDetail>
          <InvitationDetail icon={ShieldCheck} label="Role">
            {invitation.role_name_snapshot}
          </InvitationDetail>
          <InvitationDetail icon={Store} label="Store">
            {invitation.store_name_snapshot}
          </InvitationDetail>
          <InvitationDetail icon={Building2} label="Job title">
            {invitation.job_title || "Not specified"}
          </InvitationDetail>
          <InvitationDetail icon={CalendarClock} label="Expires">
            {new Intl.DateTimeFormat("en-PH", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(invitation.expires_at))}
          </InvitationDetail>
        </dl>
        <AcceptInvitationButton token={parsedToken.data} />
      </CardContent>
    </InvitationFrame>
  );
}

function InvitationFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-svh bg-muted/45 px-5 py-8 sm:py-12">
      <div className="mx-auto max-w-lg">
        <Link className="mb-8 inline-flex" href="/">
          <TindioMark />
        </Link>
        <Card className="shadow-sm">{children}</Card>
      </div>
    </main>
  );
}

function InvitationUnavailable({
  actions,
  message = "This link is invalid, expired, revoked, already accepted, or intended for a different signed-in email.",
  title = "Invitation unavailable",
}: {
  actions?: React.ReactNode;
  message?: React.ReactNode;
  title?: string;
}) {
  return (
    <InvitationFrame>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm leading-6 text-muted-foreground">{message}</p>
        {actions ?? (
          <Link className={buttonVariants({ className: "w-full" })} href="/login">
            Return to sign in
          </Link>
        )}
      </CardContent>
    </InvitationFrame>
  );
}

function InvitationSignOutAction({ signInPath }: { signInPath: string }) {
  return (
    <form action={signOutAction}>
      <input name="next" type="hidden" value={signInPath} />
      <Button className="w-full" type="submit">
        Sign out and use another account
      </Button>
    </form>
  );
}

function getRecipientEmail(value: unknown) {
  if (typeof value !== "string") return undefined;

  const email = value.trim().toLowerCase();
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : undefined;
}

function InvitationDetail({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Building2;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold">{children}</dd>
    </div>
  );
}
