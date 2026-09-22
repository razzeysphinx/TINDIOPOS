import "server-only";

import type {
  createClient,
} from "@/lib/supabase/server";

type ServerClient =
  Awaited<
    ReturnType<
      typeof createClient
    >
  >;

type IdentityProvisioningInput = {
  email:
    string | null | undefined;

  fullName:
    string | null | undefined;
};

export async function ensureCurrentIdentityProfile(
  client: ServerClient,
  {
    email,
    fullName,
  }: IdentityProvisioningInput,
) {
  const {
    data,
    error,
  } =
    await client.rpc(
      "ensure_current_identity_profile",
      {
        target_email:
          email?.trim()
          ?? "",

        target_full_name:
          fullName?.trim()
          ?? "",
      },
    );

  if (
    error
    || typeof data !== "string"
    || data.length === 0
  ) {
    return {
      ok: false as const,
      message:
        "TINDIO could not provision the authenticated business identity.",
    };
  }

  return {
    ok: true as const,
    profileId:
      data,
  };
}
