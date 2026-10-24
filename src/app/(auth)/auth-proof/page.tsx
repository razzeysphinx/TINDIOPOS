import { notFound } from "next/navigation";
import { connection } from "next/server";

import { NeonAuthProofSurface } from "@/features/auth/neon-proof-surface";
import {
  getNeonWebProofConfiguration,
  NeonWebProofConfigurationError,
} from "@/lib/auth/neon-web-proof";

export const metadata = { title: "Neon Auth proof" };
export const dynamic = "force-dynamic";

export default async function NeonAuthProofPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    event?:
      | "email-verified"
      | "password-reset"
      | "recovery-requested"
      | "signed-in"
      | "signed-out"
      | "signed-up"
      | "verification-required"
      | "verification-requested";
  }>;
}) {
  await connection();

  try {
    getNeonWebProofConfiguration();
  } catch (error) {
    if (error instanceof NeonWebProofConfigurationError) notFound();
    throw error;
  }

  const { error, event } = await searchParams;
  return <NeonAuthProofSurface error={error} event={event} />;
}
