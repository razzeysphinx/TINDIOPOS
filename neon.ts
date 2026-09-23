import {
  defineConfig,
} from "@neon/config/v1";

const supabaseUrl =
  process.env
    .NEXT_PUBLIC_SUPABASE_URL;

if (!supabaseUrl) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL is required to configure Neon Data API external authentication.",
  );
}

const supabaseJwksUrl =
  new URL(
    "/auth/v1/.well-known/jwks.json",
    supabaseUrl,
  ).toString();

export default defineConfig({
  // Neon Auth is deliberately not the TINDIO authentication authority
  // during Phase 04. Keep the already-declared service to avoid an
  // accidental destructive infrastructure removal, but TINDIO sessions
  // continue to come from Supabase Auth.
  auth: true,

  dataApi: {
    authProvider: "external",
    jwksUrl:
      supabaseJwksUrl,
  },

  preview: {
    // Existing preview resources are preserved unchanged.
    // Upgrade to a paid plan to enable AI Gateway for your project.
    // aiGateway: true,
    buckets: {
      uploads: {
        access: "private",
      },
    },
    functions: {
      api: {
        name: "api",
        source: "./hello.ts",
      },
    },
  },
});
