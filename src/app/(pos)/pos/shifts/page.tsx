import { redirect } from "next/navigation";
import { connection } from "next/server";

import { ShiftWorkspacePage } from "@/app/(back-office)/back-office/shifts/page";
import { getWorkspaceHome, hasPermission, requireBusinessContext } from "@/lib/auth/dal";

export const metadata = { title: "Shift controls" };

/** Operational shift controls belong to the POS workspace, not Back Office. */
export default async function PosShiftsPage() {
  await connection();
  const context = await requireBusinessContext();

  if (!hasPermission(context, "sales.create")) {
    redirect(getWorkspaceHome(context));
  }

  return (
    <main className="min-h-svh bg-muted/35 px-4 py-7 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <ShiftWorkspacePage mode="operations" />
      </div>
    </main>
  );
}
