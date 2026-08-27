import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getWorkspaceHome, requireBusinessContext } from "@/lib/auth/dal";

/** Resolve the employee's authorized workspace after sign-in or a deep link. */
export default async function WorkspacePage() {
  await connection();
  const context = await requireBusinessContext();
  redirect(getWorkspaceHome(context));
}
