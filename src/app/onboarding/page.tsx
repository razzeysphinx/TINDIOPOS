import {
  Building2,
  CircleCheck,
  LogOut,
  ShieldCheck,
  Store,
  WalletCards,
} from "lucide-react";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { TindioMark } from "@/components/brand/tindio-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { signOutAction } from "@/features/auth/actions";
import { AcceptPendingInvitationButton } from "@/features/management/management-forms";
import { OnboardingForm } from "@/features/onboarding/onboarding-form";
import { getBusinessContext, requireUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Business setup" };

const setupItems = [
  { icon: Building2, label: "Your organization" },
  { icon: Store, label: "A first store" },
  { icon: WalletCards, label: "A checkout register" },
  { icon: CircleCheck, label: "Secure owner access" },
];

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string }>;
}) {
  await connection();
  const user = await requireUser();
  const { add } = await searchParams;
  const existingContext = await getBusinessContext();

  if (existingContext && add !== "1") {
    redirect("/back-office");
  }

  const pendingInvitationResult = user.email
    ? await (await createClient())
        .from("employee_invitations")
        .select(
          "id, organization_name_snapshot, role_name_snapshot, store_name_snapshot, expires_at",
        )
        .eq("email", user.email.trim().toLowerCase())
        .is("accepted_at", null)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: true })
    : { data: [], error: null };

  if (pendingInvitationResult.error) {
    throw new Error(
      `Unable to load employee invitations: ${pendingInvitationResult.error.message}`,
    );
  }

  if (pendingInvitationResult.data.length > 0) {
    return (
      <main className="min-h-svh bg-muted/45 px-5 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-3xl">
          <OnboardingHeader />
          <div className="mt-10">
            <p className="text-sm font-bold tracking-[0.14em] text-primary uppercase">
              Employee access
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
              Your invitation is ready.
            </h1>
            <p className="mt-4 max-w-2xl leading-7 text-muted-foreground">
              Accept the assignment below. TINDIO will apply the role and store
              access selected by your manager, then open the areas you are allowed
              to use.
            </p>
            <div className="mt-8 grid gap-4">
              {pendingInvitationResult.data.map((invitation) => (
                <Card className="shadow-sm" key={invitation.id}>
                  <CardHeader>
                    <p className="text-sm font-semibold text-primary">
                      Invitation to {invitation.organization_name_snapshot}
                    </p>
                    <CardTitle className="text-2xl tracking-[-0.03em]">
                      {invitation.role_name_snapshot}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <dl className="grid gap-4 rounded-lg border border-border bg-muted/35 p-4 sm:grid-cols-2">
                      <div>
                        <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <Store className="size-3.5" aria-hidden="true" />
                          Assigned store
                        </dt>
                        <dd className="mt-1 text-sm font-semibold">
                          {invitation.store_name_snapshot}
                        </dd>
                      </div>
                      <div>
                        <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <ShieldCheck className="size-3.5" aria-hidden="true" />
                          Access expires
                        </dt>
                        <dd className="mt-1 text-sm font-semibold">
                          {new Intl.DateTimeFormat("en-PH", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(invitation.expires_at))}
                        </dd>
                      </div>
                    </dl>
                    <AcceptPendingInvitationButton invitationId={invitation.id} />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-svh bg-muted/45 px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <OnboardingHeader />
        <div className="mt-10 grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <section className="pt-4">
            <p className="text-sm font-bold tracking-[0.14em] text-primary uppercase">
              {existingContext ? "Additional organization" : "Phase 1 setup"}
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
              {existingContext ? "Add an independent business." : "Build your business foundation."}
            </h1>
            <p className="mt-5 max-w-md leading-7 text-muted-foreground">
              TINDIO creates these records together so you never start with a
              half-configured store. Each business remains isolated from every other organization.
            </p>
            <ul className="mt-8 grid gap-3">
              {setupItems.map(({ icon: Icon, label }) => (
                <li className="flex items-center gap-3 text-sm font-medium" key={label}>
                  <span className="grid size-9 place-items-center rounded-lg bg-secondary text-primary">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          </section>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-2xl tracking-[-0.03em]">
                Tell us about your operation
              </CardTitle>
              <p className="text-sm leading-6 text-muted-foreground">
                Defaults use PHP and Asia/Manila. Business settings will make
                these configurable before transactions begin.
              </p>
            </CardHeader>
            <CardContent>
              <OnboardingForm />
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

function OnboardingHeader() {
  return (
    <div className="flex items-center justify-between gap-4">
      <TindioMark />
      <form action={signOutAction}>
        <Button size="sm" type="submit" variant="outline">
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </form>
    </div>
  );
}
