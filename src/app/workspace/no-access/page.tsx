import { LogOut, ShieldAlert } from "lucide-react";
import { connection } from "next/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/features/auth/actions";
import { requireBusinessContext } from "@/lib/auth/dal";

export const metadata = { title: "Workspace access required" };

export default async function WorkspaceNoAccessPage() {
  await connection();
  const context = await requireBusinessContext();

  return (
    <main className="grid min-h-svh place-items-center bg-muted/35 px-4 py-8">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <ShieldAlert aria-hidden="true" className="size-8 text-primary" />
          <CardTitle className="mt-3">Workspace access is required</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 text-sm leading-6 text-muted-foreground">
          <p>
            {context.profile.full_name || context.profile.email}, your account is active but it has no permission for the POS or Back Office workspace in {context.organization.name}.
          </p>
          <p>Ask an owner or administrator to assign the appropriate role, then sign in again.</p>
          <form action={signOutAction}>
            <Button type="submit" variant="outline">
              <LogOut aria-hidden="true" />
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
